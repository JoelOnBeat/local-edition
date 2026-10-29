/** Structured JSON logger. The only module allowed to touch `console`. Redacts secret-looking fields. */

export type LogLevel = "debug" | "info" | "warn" | "error";
const order: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const SECRET_KEY = /key|token|secret|authorization|password|cookie|signature/i;

function threshold(): number {
  const raw = (typeof process !== "undefined" ? process.env?.LOG_LEVEL : undefined) as LogLevel | undefined;
  if (raw && raw in order) return order[raw];
  if (typeof process !== "undefined" && process.env?.VITEST) return order.error + 1; // quiet in tests
  return order.info;
}

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[depth]";
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => redact(v, depth + 1));
  if (value instanceof Error) return { name: value.name, message: value.message };
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_KEY.test(k) ? "[redacted]" : redact(v, depth + 1);
    }
    return out;
  }
  if (typeof value === "string" && value.length > 500) return `${value.slice(0, 500)}...`;
  return value;
}

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
  child(scope: string): Logger;
}

export function createLogger(scope = "app"): Logger {
  const emit = (level: LogLevel, msg: string, fields?: Record<string, unknown>) => {
    if (order[level] < threshold()) return;
    const line = JSON.stringify({ t: new Date().toISOString(), level, scope, msg, ...(redact(fields) as object) });
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else console.info(line);
  };
  return {
    debug: (m, f) => emit("debug", m, f),
    info: (m, f) => emit("info", m, f),
    warn: (m, f) => emit("warn", m, f),
    error: (m, f) => emit("error", m, f),
    child: (s) => createLogger(`${scope}:${s}`),
  };
}

export const log = createLogger();
