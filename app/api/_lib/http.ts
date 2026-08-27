const MAX_JSON_BODY_BYTES = 128 * 1024;

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export type JsonObject = Record<string, unknown>;

export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function readJsonObject(request: Request): Promise<JsonObject> {
  const contentLength = request.headers.get("content-length");
  if (
    contentLength &&
    Number.isFinite(Number(contentLength)) &&
    Number(contentLength) > MAX_JSON_BODY_BYTES
  ) {
    throw new ApiError(
      413,
      "PAYLOAD_TOO_LARGE",
      "Request body exceeds the 128 KiB limit.",
    );
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    throw new ApiError(400, "INVALID_JSON", "Request body must be valid JSON.");
  }

  if (!isJsonObject(payload)) {
    throw new ApiError(
      400,
      "VALIDATION_ERROR",
      "Request body must be a JSON object.",
    );
  }

  return payload;
}

export function requiredString(
  payload: JsonObject,
  key: string,
  options: { min?: number; max: number; label?: string },
): string {
  const value = payload[key];
  const label = options.label ?? key;
  const min = options.min ?? 1;

  if (typeof value !== "string") {
    throw validationError(label, `must be a string between ${min} and ${options.max} characters`);
  }

  const normalized = value.trim();
  if (normalized.length < min || normalized.length > options.max) {
    throw validationError(label, `must be between ${min} and ${options.max} characters`);
  }

  return normalized;
}

export function optionalString(
  payload: JsonObject,
  key: string,
  options: { max: number; label?: string; nullable?: boolean },
): string | null | undefined {
  const value = payload[key];
  const label = options.label ?? key;

  if (value === undefined) return undefined;
  if (value === null && options.nullable) return null;
  if (typeof value !== "string") {
    throw validationError(label, "must be a string");
  }

  const normalized = value.trim();
  if (normalized.length > options.max) {
    throw validationError(label, `must be at most ${options.max} characters`);
  }
  return normalized;
}

export function optionalBoolean(
  payload: JsonObject,
  key: string,
): boolean | undefined {
  const value = payload[key];
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") {
    throw validationError(key, "must be a boolean");
  }
  return value;
}

export function optionalInteger(
  payload: JsonObject,
  key: string,
  options: { min: number; max: number },
): number | undefined {
  const value = payload[key];
  if (value === undefined) return undefined;
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < options.min ||
    value > options.max
  ) {
    throw validationError(
      key,
      `must be an integer between ${options.min} and ${options.max}`,
    );
  }
  return value;
}

export function optionalNumber(
  payload: JsonObject,
  key: string,
  options: { min: number; max: number },
): number | undefined {
  const value = payload[key];
  if (value === undefined) return undefined;
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < options.min ||
    value > options.max
  ) {
    throw validationError(
      key,
      `must be a number between ${options.min} and ${options.max}`,
    );
  }
  return value;
}

export function optionalIsoDate(
  payload: JsonObject,
  key: string,
): string | null | undefined {
  const value = payload[key];
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (
    typeof value !== "string" ||
    value.length > 40 ||
    Number.isNaN(Date.parse(value))
  ) {
    throw validationError(key, "must be an ISO-8601 date-time string or null");
  }
  return new Date(value).toISOString();
}

export function jsonString(
  value: unknown,
  key: string,
  maxBytes = 64 * 1024,
): string {
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw validationError(key, "must be JSON serializable");
  }

  if (new TextEncoder().encode(serialized).byteLength > maxBytes) {
    throw validationError(key, `must be smaller than ${maxBytes} bytes`);
  }
  return serialized;
}

export function validationError(field: string, rule: string): ApiError {
  return new ApiError(400, "VALIDATION_ERROR", `${field} ${rule}.`, {
    field,
    rule,
  });
}

export function notFound(resource = "Interview"): ApiError {
  return new ApiError(404, "INTERVIEW_NOT_FOUND", `${resource} was not found.`);
}

export function parseJsonText<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
    },
  });
}

function databaseError(error: unknown): ApiError | undefined {
  const message = error instanceof Error ? error.message : String(error);
  const cause =
    error instanceof Error && error.cause instanceof Error
      ? error.cause.message
      : "";
  const combined = `${message}\n${cause}`.toLowerCase();

  if (
    combined.includes("no such table") ||
    combined.includes("d1 binding") ||
    combined.includes("env.db")
  ) {
    return new ApiError(
      503,
      "DATABASE_NOT_READY",
      "Persistent storage is not ready. Apply the bundled D1 migration and try again.",
    );
  }
  if (combined.includes("unique constraint")) {
    return new ApiError(
      409,
      "RESOURCE_CONFLICT",
      "A record with the same unique key already exists.",
    );
  }
  if (combined.includes("foreign key constraint")) {
    return new ApiError(
      409,
      "REFERENCE_CONFLICT",
      "A referenced record does not exist or cannot be changed.",
    );
  }
  return undefined;
}

export function errorResponse(error: unknown): Response {
  const known = error instanceof ApiError ? error : databaseError(error);
  if (known) {
    return jsonResponse(
      {
        error: {
          code: known.code,
          message: known.message,
          ...(known.details ? { details: known.details } : {}),
        },
      },
      known.status,
    );
  }

  console.error("Unhandled API error", {
    name: error instanceof Error ? error.name : "UnknownError",
    message: error instanceof Error ? error.message : String(error),
  });
  return jsonResponse(
    {
      error: {
        code: "INTERNAL_ERROR",
        message: "An unexpected server error occurred.",
      },
    },
    500,
  );
}
