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
  const format = (message: string, details?: unknown) => {
    if (details === undefined) return `[${scope}] ${message}`;
    return `[${scope}] ${message}: ${details instanceof Error ? details.message : String(details)}`;
  };

  return {
    info(_message: string, _details?: unknown) {
      void format;
    },
    warn(_message: string, _details?: unknown) {
      void format;
    },
    error(_message: string, _details?: unknown) {
      void format;
    },
  };
}
