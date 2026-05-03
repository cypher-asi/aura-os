export interface ApiError {
  error: string;
  code: string;
  details: string | null;
}

/**
 * JSON-compatible value (mirrors `serde_json::Value`). Used for arbitrary
 * payload shapes that originate as JSONB on the backend (memory facts,
 * procedure constraints, event metadata).
 */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };
