/** Telemetry mode: "off" disables all telemetry, "on" enables it. */
export type TelemetryMode = "off" | "on";

/** Severity levels for telemetry events, ordered from least to most severe. */
export type TelemetryLevel = "NONE" | "DEBUG" | "INFO" | "WARN" | "ERROR" | "CRITICAL";

/** Base fields shared by every telemetry event. */
interface TelemetryEventBase {
  ts: string;
  sessionId: string;
  level: TelemetryLevel;
}

export interface SessionStartEvent extends TelemetryEventBase {
  type: "session_start";
  agentVersion: string;
  cwdHash: string;
}

export interface SessionEndEvent extends TelemetryEventBase {
  type: "session_end";
  reason: string;
  durationMs: number;
}

export interface ModelCallEvent extends TelemetryEventBase {
  type: "model_call";
  provider: string;
  modelId: string;
  turnIndex: number;
  error: boolean;
}

export interface ToolCallEvent extends TelemetryEventBase {
  type: "tool_call";
  toolName: string;
  durationMs: number;
  error: boolean;
}

export interface ConfigChangeEvent extends TelemetryEventBase {
  type: "config_change";
  provider: string;
  modelId: string;
  source: string;
}

/** Union of all telemetry event types. */
export type TelemetryEvent =
  | SessionStartEvent
  | SessionEndEvent
  | ModelCallEvent
  | ToolCallEvent
  | ConfigChangeEvent;
