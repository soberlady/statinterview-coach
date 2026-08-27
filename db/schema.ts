import { sql } from "drizzle-orm";
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

/**
 * The database deliberately stores user-authored JSON as text. This keeps the
 * schema portable across D1/SQLite versions while the API remains responsible
 * for validating and serializing every JSON value.
 */
export const interviews = sqliteTable(
  "interviews",
  {
    id: text("id").primaryKey(),
    jobTitle: text("job_title").notNull(),
    jobDescription: text("job_description").notNull(),
    candidateBackground: text("candidate_background").notNull().default(""),
    durationMinutes: integer("duration_minutes").notNull().default(15),
    cameraEnabled: integer("camera_enabled", { mode: "boolean" })
      .notNull()
      .default(true),
    recordingEnabled: integer("recording_enabled", { mode: "boolean" })
      .notNull()
      .default(false),
    mode: text("mode").notNull().default("diagnostic"),
    status: text("status").notNull().default("CREATED"),
    currentStage: text("current_stage").notNull().default("CREATED"),
    currentQuestionId: text("current_question_id"),
    checkpoint: text("checkpoint").notNull().default("{}"),
    checkpointVersion: integer("checkpoint_version").notNull().default(0),
    turnCount: integer("turn_count").notNull().default(0),
    verificationCount: integer("verification_count").notNull().default(0),
    startedAt: text("started_at"),
    completedAt: text("completed_at"),
    lastCheckpointAt: text("last_checkpoint_at"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("interviews_status_updated_idx").on(table.status, table.updatedAt),
    index("interviews_created_at_idx").on(table.createdAt),
  ],
);

export const interviewTurns = sqliteTable(
  "interview_turns",
  {
    id: text("id").primaryKey(),
    interviewId: text("interview_id")
      .notNull()
      .references(() => interviews.id, { onDelete: "cascade" }),
    sequenceNumber: integer("sequence_number").notNull(),
    questionId: text("question_id"),
    questionText: text("question_text").notNull(),
    skill: text("skill").notNull(),
    questionType: text("question_type").notNull().default("adaptive"),
    answerText: text("answer_text").notNull().default(""),
    inputMode: text("input_mode").notNull().default("voice"),
    status: text("status").notNull().default("completed"),
    transcriptConfidence: real("transcript_confidence"),
    evidence: text("evidence").notNull().default("[]"),
    evaluation: text("evaluation").notNull().default("{}"),
    reliability: text("reliability"),
    startedAt: text("started_at"),
    completedAt: text("completed_at"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("interview_turns_interview_sequence_uq").on(
      table.interviewId,
      table.sequenceNumber,
    ),
    index("interview_turns_interview_created_idx").on(
      table.interviewId,
      table.createdAt,
    ),
    index("interview_turns_interview_skill_idx").on(
      table.interviewId,
      table.skill,
    ),
  ],
);

export const skillStates = sqliteTable(
  "skill_states",
  {
    id: text("id").primaryKey(),
    interviewId: text("interview_id")
      .notNull()
      .references(() => interviews.id, { onDelete: "cascade" }),
    skill: text("skill").notNull(),
    posteriorMean: real("posterior_mean").notNull().default(0),
    uncertainty: real("uncertainty").notNull().default(1),
    posterior: text("posterior").notNull().default("[]"),
    supportingEvidence: text("supporting_evidence").notNull().default("[]"),
    commonErrors: text("common_errors").notNull().default("[]"),
    sourceTurnCount: integer("source_turn_count").notNull().default(0),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("skill_states_interview_skill_uq").on(
      table.interviewId,
      table.skill,
    ),
    index("skill_states_interview_updated_idx").on(
      table.interviewId,
      table.updatedAt,
    ),
  ],
);

export const agentEvents = sqliteTable(
  "agent_events",
  {
    id: text("id").primaryKey(),
    interviewId: text("interview_id")
      .notNull()
      .references(() => interviews.id, { onDelete: "cascade" }),
    turnId: text("turn_id").references(() => interviewTurns.id, {
      onDelete: "set null",
    }),
    eventType: text("event_type").notNull(),
    fromState: text("from_state"),
    toState: text("to_state"),
    payload: text("payload").notNull().default("{}"),
    latencyMs: integer("latency_ms"),
    model: text("model"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    estimatedCostMicrousd: integer("estimated_cost_microusd"),
    idempotencyKey: text("idempotency_key"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("agent_events_idempotency_key_uq").on(table.idempotencyKey),
    index("agent_events_interview_created_idx").on(
      table.interviewId,
      table.createdAt,
    ),
    index("agent_events_type_created_idx").on(
      table.eventType,
      table.createdAt,
    ),
  ],
);

export const userFeedback = sqliteTable(
  "user_feedback",
  {
    id: text("id").primaryKey(),
    interviewId: text("interview_id")
      .notNull()
      .references(() => interviews.id, { onDelete: "cascade" }),
    rating: integer("rating"),
    wouldUseAgain: integer("would_use_again", { mode: "boolean" }),
    comment: text("comment").notNull().default(""),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("user_feedback_interview_created_idx").on(
      table.interviewId,
      table.createdAt,
    ),
  ],
);

export type Interview = typeof interviews.$inferSelect;
export type InterviewTurn = typeof interviewTurns.$inferSelect;
export type SkillState = typeof skillStates.$inferSelect;
export type AgentEvent = typeof agentEvents.$inferSelect;
export type UserFeedback = typeof userFeedback.$inferSelect;
