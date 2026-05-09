import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** Minimal logger interface used by the extension runtime. */
export interface AuthentikLogger {
  info(message: string, details?: unknown): void;
  warn(message: string, details?: unknown): void;
  error(message: string, details?: unknown): void;
}

type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";

/**
 * Creates a scoped logger for the extension runtime that emits to pi-logger event bus.
 * @param pi - ExtensionAPI instance for event bus access.
 * @param scope - Logical logging scope name (channel).
 * @returns Logger methods compatible with the extension's internal usage.
 */
export function createLogger(pi: ExtensionAPI, scope: string): AuthentikLogger {
  const emit = (level: LogLevel, message: string, details?: unknown): void => {
    const data: Record<string, unknown> = { message };
    if (details !== undefined) {
      if (details instanceof Error) {
        data.error = details.message;
        if (details.stack) data.stack = details.stack;
      } else {
        data.details = details;
      }
    }

    pi.events.emit("log", {
      channel: scope,
      level,
      data,
    });
  };

  return {
    info(message: string, details?: unknown) {
      emit("INFO", message, details);
    },
    warn(message: string, details?: unknown) {
      emit("WARN", message, details);
    },
    error(message: string, details?: unknown) {
      emit("ERROR", message, details);
    },
  };
}
