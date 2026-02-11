import type { TelemetryLevel, TelemetryMode } from "./types.js";

/** Runtime configuration for the telemetry extension. */
export interface TelemetryConfig {
  mode: TelemetryMode;
  level: TelemetryLevel;
}

/** Default config: telemetry on, level INFO. */
export const defaultTelemetryConfig: TelemetryConfig = {
  mode: "on",
  level: "INFO",
};

/** Numeric ordering for severity levels. */
const LEVEL_ORDER: Record<TelemetryLevel, number> = {
  NONE: 0,
  DEBUG: 1,
  INFO: 2,
  WARN: 3,
  ERROR: 4,
  CRITICAL: 5,
};

/**
 * Returns true if an event at the given level should be logged
 * according to the current config level.
 *
 * Example: config.level = "WARN" → only WARN, ERROR, CRITICAL pass.
 */
export function shouldLog(config: TelemetryConfig, level: TelemetryLevel): boolean {
  if (config.mode === "off" || config.level === "NONE") return false;
  return LEVEL_ORDER[level] >= LEVEL_ORDER[config.level];
}
