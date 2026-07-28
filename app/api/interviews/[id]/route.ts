import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { interviews, interviewTurns, skillStates } from "@/db/schema";
import {
  ApiError,
  errorResponse,
  isJsonObject,
  jsonResponse,
  jsonString,
  optionalIsoDate,
  optionalString,
  readJsonObject,
  validationError,
} from "../../_lib/http";
import {
  assertStateTransition,
  parseInterviewState,
  readCheckpoint,
  serializeInterview,
  serializeSkillState,
  serializeTurn,
} from "../../_lib/interviews";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const db = getDb();
    const [interview] = await db
      .select()
      .from(interviews)
      .where(eq(interviews.id, id))
      .limit(1);

    if (!interview) {
      throw new ApiError(
        404,
        "INTERVIEW_NOT_FOUND",
        "Interview was not found.",
      );
    }

    const [states, recentTurns] = await Promise.all([
      db
        .select()
        .from(skillStates)
        .where(eq(skillStates.interviewId, id))
        .orderBy(skillStates.skill),
      db
        .select()
        .from(interviewTurns)
        .where(eq(interviewTurns.interviewId, id))
        .orderBy(interviewTurns.sequenceNumber)
        .limit(100),
    ]);

    return jsonResponse({
      interview: serializeInterview(interview),
      skillStates: states.map(serializeSkillState),
      turns: recentTurns.map(serializeTurn),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const payload = await readJsonObject(request);
    const db = getDb();
    const [existing] = await db
      .select()
      .from(interviews)
      .where(eq(interviews.id, id))
      .limit(1);

    if (!existing) {
      throw new ApiError(
        404,
        "INTERVIEW_NOT_FOUND",
        "Interview was not found.",
      );
    }

    const status = parseInterviewState(payload.status, "status");
    const currentStage = parseInterviewState(
      payload.currentStage,
      "currentStage",
    );
    if (status) assertStateTransition(existing.status, status);
    if (currentStage) {
      assertStateTransition(existing.currentStage, currentStage);
    }

    const expectedCheckpointVersion = payload.expectedCheckpointVersion;
    if (
      expectedCheckpointVersion !== undefined &&
      (!Number.isInteger(expectedCheckpointVersion) ||
        (expectedCheckpointVersion as number) < 0)
    ) {
      throw validationError(
        "expectedCheckpointVersion",
        "must be a non-negative integer",
      );
    }
    if (
      expectedCheckpointVersion !== undefined &&
      expectedCheckpointVersion !== existing.checkpointVersion
    ) {
      throw new ApiError(
        409,
        "CHECKPOINT_VERSION_CONFLICT",
        "The interview checkpoint has changed. Reload before saving again.",
        {
          expected: expectedCheckpointVersion,
          actual: existing.checkpointVersion,
        },
      );
    }

    const currentQuestionId = optionalString(payload, "currentQuestionId", {
      max: 128,
      nullable: true,
    });
    const startedAt = optionalIsoDate(payload, "startedAt");
    const completedAt = optionalIsoDate(payload, "completedAt");
    const now = new Date().toISOString();
    const updates: Partial<typeof interviews.$inferInsert> = {
      updatedAt: now,
    };

    if (status) updates.status = status;
    if (currentStage) updates.currentStage = currentStage;
    if (currentQuestionId !== undefined) {
      updates.currentQuestionId = currentQuestionId;
    }
    if (startedAt !== undefined) updates.startedAt = startedAt;
    if (completedAt !== undefined) updates.completedAt = completedAt;
    if (status === "COMPLETED" && completedAt === undefined) {
      updates.completedAt = now;
    }

    if (payload.checkpoint !== undefined) {
      const checkpoint = readCheckpoint(payload.checkpoint);
      updates.checkpoint = jsonString(checkpoint, "checkpoint");
      updates.checkpointVersion = existing.checkpointVersion + 1;
      updates.lastCheckpointAt = now;
    }

    const skillStateUpdates = parseSkillStateUpdates(payload.skillStates);
    const hasInterviewUpdates =
      Object.keys(updates).some((key) => key !== "updatedAt");
    if (!hasInterviewUpdates && skillStateUpdates.length === 0) {
      throw validationError(
        "request",
        "must include a checkpoint, state, timestamp, currentQuestionId, or skillStates",
      );
    }

    const [updated] = await db
      .update(interviews)
      .set(updates)
      .where(eq(interviews.id, id))
      .returning();

    for (const state of skillStateUpdates) {
      await db
        .insert(skillStates)
        .values({
          id: `skill_${crypto.randomUUID()}`,
          interviewId: id,
          ...state,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [skillStates.interviewId, skillStates.skill],
          set: {
            posteriorMean: state.posteriorMean,
            uncertainty: state.uncertainty,
            posterior: state.posterior,
            supportingEvidence: state.supportingEvidence,
            commonErrors: state.commonErrors,
            sourceTurnCount: state.sourceTurnCount,
            updatedAt: now,
          },
        });
    }

    const states = await db
      .select()
      .from(skillStates)
      .where(eq(skillStates.interviewId, id))
      .orderBy(skillStates.skill);

    return jsonResponse({
      interview: serializeInterview(updated),
      skillStates: states.map(serializeSkillState),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

type ParsedSkillState = {
  skill: string;
  posteriorMean: number;
  uncertainty: number;
  posterior: string;
  supportingEvidence: string;
  commonErrors: string;
  sourceTurnCount: number;
};

function parseSkillStateUpdates(value: unknown): ParsedSkillState[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 20) {
    throw validationError("skillStates", "must be an array of at most 20 items");
  }

  const seen = new Set<string>();
  return value.map((raw, index) => {
    if (!isJsonObject(raw)) {
      throw validationError(`skillStates[${index}]`, "must be an object");
    }

    const skill = raw.skill;
    const posteriorMean = raw.posteriorMean;
    const uncertainty = raw.uncertainty;
    const sourceTurnCount = raw.sourceTurnCount ?? 0;

    if (
      typeof skill !== "string" ||
      skill.trim().length < 1 ||
      skill.trim().length > 80
    ) {
      throw validationError(
        `skillStates[${index}].skill`,
        "must be a string between 1 and 80 characters",
      );
    }
    if (seen.has(skill.trim())) {
      throw validationError(
        `skillStates[${index}].skill`,
        "must not be duplicated in this request",
      );
    }
    seen.add(skill.trim());

    if (
      typeof posteriorMean !== "number" ||
      !Number.isFinite(posteriorMean) ||
      posteriorMean < -3 ||
      posteriorMean > 3
    ) {
      throw validationError(
        `skillStates[${index}].posteriorMean`,
        "must be a number between -3 and 3",
      );
    }
    if (
      typeof uncertainty !== "number" ||
      !Number.isFinite(uncertainty) ||
      uncertainty < 0 ||
      uncertainty > 10
    ) {
      throw validationError(
        `skillStates[${index}].uncertainty`,
        "must be a number between 0 and 10",
      );
    }
    if (
      !Number.isInteger(sourceTurnCount) ||
      (sourceTurnCount as number) < 0 ||
      (sourceTurnCount as number) > 10_000
    ) {
      throw validationError(
        `skillStates[${index}].sourceTurnCount`,
        "must be an integer between 0 and 10000",
      );
    }

    return {
      skill: skill.trim(),
      posteriorMean,
      uncertainty,
      posterior: jsonString(
        raw.posterior ?? [],
        `skillStates[${index}].posterior`,
        32 * 1024,
      ),
      supportingEvidence: jsonString(
        raw.supportingEvidence ?? [],
        `skillStates[${index}].supportingEvidence`,
        32 * 1024,
      ),
      commonErrors: jsonString(
        raw.commonErrors ?? [],
        `skillStates[${index}].commonErrors`,
        32 * 1024,
      ),
      sourceTurnCount: sourceTurnCount as number,
    };
  });
}
