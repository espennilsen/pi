import { TodoistApi } from "@doist/todoist-api-typescript";
import type { TodoistSettings } from "./settings.ts";

let client: TodoistApi | null = null;

export function initClient(settings: TodoistSettings): void {
  if (!settings.apiToken) {
    client = null;
    return;
  }
  client = new TodoistApi(settings.apiToken);
}

export function resetClient(): void {
  client = null;
}

export function getClient(): TodoistApi {
  if (!client) {
    throw new Error("Todoist client not initialized. Set pi-todoist.apiToken in settings.json");
  }
  return client;
}

export function isClientReady(): boolean {
  return client !== null;
}
