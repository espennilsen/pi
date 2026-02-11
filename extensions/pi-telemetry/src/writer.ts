import { getAgentDir } from "@mariozechner/pi-coding-agent";
import * as fs from "node:fs";
import * as path from "node:path";
import type { TelemetryEvent } from "./types.js";

/** Resolve the telemetry directory under the pi agent dir. */
function getTelemetryDir(): string {
  return path.join(getAgentDir(), "telemetry");
}

/** Return the JSONL file path for today: `YYYY-MM-DD.jsonl`. */
function getDayFile(): string {
  const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  return path.join(getTelemetryDir(), `${date}.jsonl`);
}

/**
 * Append a single telemetry event as one JSON line to the daily JSONL file.
 * Creates the telemetry directory if it doesn't exist.
 * Errors are silently swallowed so telemetry never disrupts the agent.
 */
export function writeTelemetryEvent(event: TelemetryEvent): void {
  try {
    const dir = getTelemetryDir();
    fs.mkdirSync(dir, { recursive: true });
    const line = JSON.stringify(event) + "\n";
    fs.appendFileSync(getDayFile(), line, "utf-8");
  } catch {
    // Swallow – telemetry must never break the agent.
  }
}
