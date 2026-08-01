import { and, asc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { agentEvents, interviews, interviewTurns } from "@/db/schema";
import {
  ApiError,
  errorResponse,
  isJsonObject,
  jsonResponse,
  jsonString,
  optionalInteger,
  optionalString,
  readJsonObject,
  requiredString,
  validationError,
} from "../../../_lib/http";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const url = new URL(request.url);
    const requestedLimit = url.searchParams.get("limit");
    const limit = requestedLimit === null ? 200 : Number(requestedLimit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 1_000) {
      throw validationError("limit", "must be an integer between 1 and 1000");
    }

    const db = getDb();
    await requireInterview(db, id);
    const events = await db
      .select()
      .from(agentEvents)
      .where(eq(agentEvents.interviewId, id))
      .orderBy(asc(agentEvents.createdAt))
      .limit(limit);

    return jsonResponse({
      events: events.map((event) => ({
        ...event,
        payload: safeParseEventPayload(event.payload),
      })),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const { id: interviewId } = await context.params;
    const payload = await readJsonObject(request);
    const eventType = requiredString(payload, "eventType", { max: 80 });
    if (!/^[a-z][a-z0-9_.-]*$/i.test(eventType)) {
      throw validationError(
        "eventType",
        "must contain only letters, numbers, dots, underscores, or hyphens",
      );
    }
    if (eventType === "turn_evaluated") {
      throw validationError(
        "eventType",
        "uses a server-reserved event type",
      );
    }

    const turnId = optionalString(payload, "turnId", {
      max: 80,
      nullable: true,
    });
    const fromState = optionalString(payload, "fromState", {
      max: 40,
      nullable: true,
    });
    const toState = optionalString(payload, "toState", {
      max: 40,
      nullable: true,
    });
    const model = optionalString(payload, "model", {
      max: 120,
      nullable: true,
    });
    const idempotencyKey = optionalString(payload, "idempotencyKey", {
      max: 160,
      nullable: true,
    });
    if (idempotencyKey?.toLowerCase().startsWith("internal:")) {
      throw validationError(
        "idempotencyKey",
        "uses a server-reserved namespace",
      );
    }
    const latencyMs = optionalInteger(payload, "latencyMs", {
      min: 0,
      max: 3_600_000,
    });
    const inputTokens = optionalInteger(payload, "inputTokens", {
      min: 0,
      max: 100_000_000,
    });
    const outputTokens = optionalInteger(payload, "outputTokens", {
      min: 0,
      max: 100_000_000,
    });
    const estimatedCostMicrousd = optionalInteger(
      payload,
      "estimatedCostMicrousd",
      { min: 0, max: 2_000_000_000 },
    );
    const eventPayload = payload.payload ?? {};
    if (!isJsonObject(eventPayload)) {
      throw validationError("payload", "must be a JSON object");
    }

    const db = getDb();
    await requireInterview(db, interviewId);

    if (turnId) {
      const [turn] = await db
        .select({ id: interviewTurns.id })
        .from(interviewTurns)
        .where(
          and(
            eq(interviewTurns.id, turnId),
            eq(interviewTurns.interviewId, interviewId),
          ),
        )
        .limit(1);
      if (!turn) {
        throw new ApiError(
          409,
          "TURN_REFERENCE_CONFLICT",
          "turnId does not belong to this interview.",
        );
      }
    }

    if (idempotencyKey) {
      const [existing] = await db
        .select()
        .from(agentEvents)
        .where(eq(agentEvents.idempotencyKey, idempotencyKey))
        .limit(1);
      if (existing) {
        if (existing.interviewId !== interviewId) {
          throw new ApiError(
            409,
            "IDEMPOTENCY_KEY_CONFLICT",
            "This idempotency key belongs to another interview.",
          );
        }
        return jsonResponse({
          event: {
            ...existing,
            payload: safeParseEventPayload(existing.payload),
          },
        });
      }
    }

    const [event] = await db
      .insert(agentEvents)
      .values({
        id: `evt_${crypto.randomUUID()}`,
        interviewId,
        turnId,
        eventType,
        fromState,
        toState,
        payload: jsonString(eventPayload, "payload", 32 * 1024),
        latencyMs,
        model,
        inputTokens,
        outputTokens,
        estimatedCostMicrousd,
        idempotencyKey,
        createdAt: new Date().toISOString(),
      })
      .returning();

    return jsonResponse(
      {
        event: {
          ...event,
          payload: safeParseEventPayload(event.payload),
        },
      },
      201,
    );
  } catch (error) {
    return errorResponse(error);
  }
}

async function requireInterview(
  db: ReturnType<typeof getDb>,
  id: string,
): Promise<void> {
  const [interview] = await db
    .select({ id: interviews.id })
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
}

function safeParseEventPayload(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value);
    return isJsonObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}
