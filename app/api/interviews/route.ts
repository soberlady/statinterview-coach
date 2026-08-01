import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { interviews, skillStates } from "@/db/schema";
import {
  errorResponse,
  jsonResponse,
  optionalBoolean,
  optionalInteger,
  optionalString,
  readJsonObject,
  requiredString,
  validationError,
} from "../_lib/http";
import { serializeInterview, SKILL_KEYS } from "../_lib/interviews";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const limitParam = url.searchParams.get("limit");
    const offsetParam = url.searchParams.get("offset");
    const statusParam = url.searchParams.get("status");
    const limit = limitParam === null ? 20 : Number(limitParam);
    const offset = offsetParam === null ? 0 : Number(offsetParam);

    if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
      throw validationError("limit", "must be an integer between 1 and 50");
    }
    if (!Number.isInteger(offset) || offset < 0 || offset > 10_000) {
      throw validationError("offset", "must be an integer between 0 and 10000");
    }

    const conditions = [];
    if (statusParam) {
      const normalized = statusParam.trim().toUpperCase();
      conditions.push(eq(interviews.status, normalized));
    }

    const db = getDb();
    const rows = await db
      .select()
      .from(interviews)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(interviews.updatedAt), desc(interviews.createdAt))
      .limit(limit + 1)
      .offset(offset);

    const hasMore = rows.length > limit;
    return jsonResponse({
      interviews: rows.slice(0, limit).map(serializeInterview),
      pagination: {
        limit,
        offset,
        hasMore,
        nextOffset: hasMore ? offset + limit : null,
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const payload = await readJsonObject(request);
    const normalizedPayload = {
      ...payload,
      jobTitle: payload.jobTitle ?? payload.targetRole,
      candidateBackground:
        payload.candidateBackground ?? payload.personalExperience ?? "",
      recordingEnabled:
        payload.recordingEnabled ?? payload.saveRecording ?? false,
    };

    const jobTitle = requiredString(normalizedPayload, "jobTitle", {
      max: 120,
    });
    const jobDescription = requiredString(
      normalizedPayload,
      "jobDescription",
      { max: 20_000 },
    );
    const candidateBackground =
      optionalString(normalizedPayload, "candidateBackground", {
        max: 10_000,
      }) ?? "";
    const durationMinutes =
      optionalInteger(normalizedPayload, "durationMinutes", {
        min: 5,
        max: 60,
      }) ?? 15;
    const cameraEnabled =
      optionalBoolean(normalizedPayload, "cameraEnabled") ?? true;
    const recordingEnabled =
      optionalBoolean(normalizedPayload, "recordingEnabled") ?? false;
    const mode =
      optionalString(normalizedPayload, "mode", { max: 32 }) ?? "diagnostic";

    if (!["diagnostic", "training"].includes(mode)) {
      throw validationError("mode", "must be diagnostic or training");
    }

    const id = `int_${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    const db = getDb();
    const [createdInterviews, createdSkillStates] = await db.batch([
      db
        .insert(interviews)
        .values({
          id,
          jobTitle,
          jobDescription,
          candidateBackground,
          durationMinutes,
          cameraEnabled,
          recordingEnabled,
          mode,
          createdAt: now,
          updatedAt: now,
        })
        .returning(),
      db
        .insert(skillStates)
        .values(
          SKILL_KEYS.map((skill) => ({
            id: `skill_${crypto.randomUUID()}`,
            interviewId: id,
            skill,
            posteriorMean: 0,
            uncertainty: 1,
            posterior: "[]",
            supportingEvidence: "[]",
            commonErrors: "[]",
            sourceTurnCount: 0,
            createdAt: now,
            updatedAt: now,
          })),
        )
        .returning({ id: skillStates.id }),
    ]);
    const interview = createdInterviews[0];
    if (!interview || createdSkillStates.length !== SKILL_KEYS.length) {
      throw new Error("atomic interview creation returned incomplete rows");
    }

    return jsonResponse({ interview: serializeInterview(interview) }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
