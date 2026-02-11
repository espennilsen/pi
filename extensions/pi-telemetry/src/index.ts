/**
 * pi-telemetry – local-only telemetry extension for pi.
 *
 * Records lightweight, privacy-safe events (no prompts, completions, or file
 * contents) to per-day JSONL files under `~/.pi/agent/telemetry/`.
 *
 * Enable in settings.json:
 * {
 *   "telemetry": { "mode": "on", "level": "INFO" }
 * }
 */

import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { getAgentDir, VERSION } from "@mariozechner/pi-coding-agent";
import { type TelemetryConfig, defaultTelemetryConfig, shouldLog } from "./config.js";
import type { TelemetryEvent, TelemetryLevel } from "./types.js";
import { writeTelemetryEvent } from "./writer.js";

/** Hash a string to a short hex digest (no PII leaves the machine). */
function hashString(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

export default function piTelemetryExtension(pi: ExtensionAPI) {
  // ── Config ──────────────────────────────────────────────────────────
  let config: TelemetryConfig = { ...defaultTelemetryConfig };
  let sessionId = "";
  let sessionStartTs = 0;

  // Track current model for model_call events
  let currentProvider = "";
  let currentModelId = "";

  // Timing helpers for tool calls
  const toolStartTimes = new Map<string, number>();

  // ── Emit helper ─────────────────────────────────────────────────────
  function emit(partial: Omit<TelemetryEvent, "ts" | "sessionId">): void {
    if (!shouldLog(config, partial.level)) return;
    const event = {
      ...partial,
      ts: new Date().toISOString(),
      sessionId,
    } as TelemetryEvent;
    writeTelemetryEvent(event);
  }

  /** Read telemetry config from settings.json on disk. */
  function loadConfigFromSettings(): void {
    try {
      const settingsPath = path.join(getAgentDir(), "settings.json");
      const raw = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
      const t = raw?.telemetry ?? {};
      config = {
        mode: t.mode === "on" ? "on" : defaultTelemetryConfig.mode,
        level: (["NONE", "DEBUG", "INFO", "WARN", "ERROR", "CRITICAL"].includes(t.level)
          ? t.level
          : defaultTelemetryConfig.level) as TelemetryLevel,
      };
    } catch {
      config = { ...defaultTelemetryConfig };
    }
  }

  // ── Session events ──────────────────────────────────────────────────
  pi.on("session_start", async (_event, ctx) => {
    loadConfigFromSettings();

    if (config.mode === "off") return;

    sessionId = hashString(`${Date.now()}-${Math.random()}`);
    sessionStartTs = Date.now();

    emit({
      type: "session_start",
      level: "INFO",
      agentVersion: VERSION ?? "unknown",
      cwdHash: hashString(ctx.cwd),
    });
  });

  pi.on("session_shutdown", async () => {
    if (config.mode === "off") return;

    emit({
      type: "session_end",
      level: "INFO",
      reason: "shutdown",
      durationMs: Date.now() - sessionStartTs,
    });
  });

  // ── Model events ────────────────────────────────────────────────────
  pi.on("model_select", async (event) => {
    currentProvider = event.model.provider;
    currentModelId = event.model.id;

    if (config.mode === "off") return;

    emit({
      type: "config_change",
      level: "INFO",
      provider: event.model.provider,
      modelId: event.model.id,
      source: event.source,
    });
  });

  // ── Turn events (proxy for model calls) ─────────────────────────────
  let currentTurnIndex = 0;

  pi.on("turn_start", async (event) => {
    if (config.mode === "off") return;
    currentTurnIndex = event.turnIndex;
  });

  pi.on("turn_end", async (event) => {
    if (config.mode === "off") return;

    // A completed turn means the model was called successfully.
    const hasError = event.toolResults?.some((r: any) => r.isError) ?? false;

    emit({
      type: "model_call",
      level: hasError ? "WARN" : "INFO",
      provider: currentProvider,
      modelId: currentModelId,
      turnIndex: event.turnIndex,
      error: false,
    });
  });

  // ── Tool events ─────────────────────────────────────────────────────
  pi.on("tool_call", async (event) => {
    if (config.mode === "off") return;
    toolStartTimes.set(event.toolCallId, Date.now());
  });

  pi.on("tool_result", async (event) => {
    if (config.mode === "off") return;

    const startTs = toolStartTimes.get(event.toolCallId) ?? Date.now();
    toolStartTimes.delete(event.toolCallId);
    const durationMs = Date.now() - startTs;
    const isError = !!event.isError;

    emit({
      type: "tool_call",
      level: isError ? "ERROR" : "INFO",
      toolName: event.toolName,
      durationMs,
      error: isError,
    });
  });

  // ── Command: /telemetry ─────────────────────────────────────────────
  pi.registerCommand("telemetry", {
    description: "View or change telemetry mode/level",
    handler: async (args, ctx) => {
      if (!args || args.trim().length === 0) {
        ctx.ui.notify(`Telemetry: mode=${config.mode}, level=${config.level}`, "info");
        return;
      }

      const parts = args.trim().split(/\s+/);
      for (const part of parts) {
        if (part === "on" || part === "off") {
          config.mode = part;
        } else if (["NONE", "DEBUG", "INFO", "WARN", "ERROR", "CRITICAL"].includes(part.toUpperCase())) {
          config.level = part.toUpperCase() as TelemetryLevel;
        }
      }

      ctx.ui.notify(`Telemetry updated: mode=${config.mode}, level=${config.level}`, "info");
    },
  });
}
