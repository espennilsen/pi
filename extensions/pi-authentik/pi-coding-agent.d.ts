declare module "@earendil-works/pi-coding-agent" {
  export interface ExtensionAPI {
    events: {
      emit(event: string, data?: unknown): void;
    };
  }

  export function getAgentDir(): string;

  export interface SettingsLike {
    getGlobalSettings(): unknown;
    getProjectSettings(): unknown;
  }

  export class SettingsManager {
    static create(cwd: string, agentDir: string): SettingsLike;
  }
}
