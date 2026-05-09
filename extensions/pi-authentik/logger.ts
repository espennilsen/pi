/** Minimal logger interface used by the extension runtime. */
export interface AuthentikLogger {
  info(message: string, details?: unknown): void;
  warn(message: string, details?: unknown): void;
  error(message: string, details?: unknown): void;
}

/**
 * Creates a scoped logger placeholder for the extension runtime.
 * @param scope - Logical logging scope name.
 * @returns Logger methods compatible with the extension's internal usage.
 */
export function createLogger(scope: string): AuthentikLogger {
  const format = (message: string, details?: unknown): string => {
    if (details === undefined) return `[${scope}] ${message}`;
    if (details instanceof Error) {
      const stack = details.stack ? `\n${details.stack}` : "";
      return `[${scope}] ${message}: ${details.message}${stack}`;
    }
    return `[${scope}] ${message}: ${String(details)}`;
  };

  return {
    info(message: string, details?: unknown) {
      console.log(format(message, details));
    },
    warn(message: string, details?: unknown) {
      console.warn(format(message, details));
    },
    error(message: string, details?: unknown) {
      console.error(format(message, details));
    },
  };
}
