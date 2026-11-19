import { getKey, setKey, updateKey } from "./storage.js";

const LOG_KEY = "logs";
const MAX_ENTRIES = 300;

export function serializeError(err) {
  if (!err) return null;
  if (typeof err === "string") return err;
  return {
    name: err.name || "Error",
    message: err.message || String(err),
    stack: err.stack || undefined,
  };
}

async function log(level, scope, message, details) {
  const entry = {
    time: Date.now(),
    level, // "info" | "warn" | "error"
    scope, // e.g. "refresh", "reader", "import"
    message: String(message),
    details: details instanceof Error ? serializeError(details) : details ?? null,
  };
  (console[level] || console.log)(`[${scope}] ${entry.message}`, details ?? "");
  try {
    await updateKey(
      LOG_KEY,
      (logs) => {
        logs.push(entry);
        if (logs.length > MAX_ENTRIES) logs.splice(0, logs.length - MAX_ENTRIES);
        return logs;
      },
      []
    );
  } catch (e) {
    console.error("Failed to persist log entry", e);
  }
  return entry;
}

export const logger = {
  info: (scope, message, details) => log("info", scope, message, details),
  warn: (scope, message, details) => log("warn", scope, message, details),
  error: (scope, message, details) => log("error", scope, message, details),
};

export const getLogs = () => getKey(LOG_KEY, []);
export const clearLogs = () => setKey(LOG_KEY, []);