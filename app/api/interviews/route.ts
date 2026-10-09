import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { interviews, interviewTurns, skillStates } from "@/db/schema";
import { inferJobWeights } from "@/app/lib/agent-policy";
import { COACHING_POLICY_VERSION, createTrainingPlan, readPolicyConfig, interviewQuestionBankVersion, type ExperienceBand, type PolicyConfig } from "@/app/lib/practice-plan";
import { CURRENT_QUESTION_BANK_VERSION, type QuestionBankVersion } from "@/app/lib/question-bank";
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
    const sourceInterviewId = optionalString(payload, "sourceInterviewId", { max: 128 });
    let source: typeof interviews.$inferSelect | undefined;
    let trainingPlan: PolicyConfig["trainingPlan"];
    let questionBankVersion: QuestionBankVersion = CURRENT_QUESTION_BANK_VERSION;
    if (sourceInterviewId) {
      const db = getDb();
      [source] = await db.select().from(interviews).where(eq(interviews.id, sourceInterviewId)).limit(1);
      if (!source || !["COMPLETED", "FINALIZING", "PAUSED"].includes(source.status) || source.mode === "guided_demo") {
        throw validationError("sourceInterviewId", "请先完成或暂停一次真实练习，再创建专项训练。");
      }
      const [turns, states] = await Promise.all([
        db.select().from(interviewTurns).where(eq(interviewTurns.interviewId, source.id)).orderBy(interviewTurns.sequenceNumber),
        db.select().from(skillStates).where(eq(skillStates.interviewId, source.id)),
      ]);
      const sourceConfig = readPolicyConfig(source.policyConfig);
      if (sourceConfig) questionBankVersion = interviewQuestionBankVersion(source);
      trainingPlan = createTrainingPlan({ sourceInterviewId: source.id, turns, states, questionBankVersion,
        jobWeights: inferJobWeights(source.jobDescription), previousPlan: readPolicyConfig(source.policyConfig)?.trainingPlan }) ?? undefined;
      if (!trainingPlan) throw validationError("sourceInterviewId", "当前证据或未见场景题不足以安排三题专项训练，请先完成一次新的诊断。");
      Object.assign(normalizedPayload, { jobTitle: source.jobTitle, jobDescription: source.jobDescription,
        candidateBackground: source.candidateBackground, durationMinutes: 10, mode: "training" });
    }

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
      }) ?? 20;
    const cameraEnabled =
      optionalBoolean(normalizedPayload, "cameraEnabled") ?? true;
    const recordingEnabled =
      optionalBoolean(normalizedPayload, "recordingEnabled") ?? false;
    const mode =
      optionalString(normalizedPayload, "mode", { max: 32 }) ?? "diagnostic";

    if (!["diagnostic", "training", "guided_demo"].includes(mode)) {
      throw validationError(
        "mode",
        "must be diagnostic, training or guided_demo",
      );
    }
    if (mode === "training" && !trainingPlan) throw validationError("sourceInterviewId", "专项训练必须从已有练习报告创建。");
    const experienceBand = optionalString(payload, "experienceBand", { max: 20 });
    if (experienceBand && !["beginner", "intermediate", "advanced"].includes(experienceBand)) {
      throw validationError("experienceBand", "请选择入门、有项目经验或有工作经验。");
    }
    const policyConfig: PolicyConfig = { version: COACHING_POLICY_VERSION, questionBankVersion,
      ...(experienceBand ? { experienceBand: experienceBand as ExperienceBand } : {}),
      ...(trainingPlan ? { trainingPlan } : {}) };

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
          policyConfig: JSON.stringify(policyConfig),
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
