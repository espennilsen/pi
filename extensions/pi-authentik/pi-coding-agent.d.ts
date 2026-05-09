declare module "@earendil-works/pi-coding-agent" {
  export interface ExtensionAPI {}

  export function getAgentDir(): string;

  export interface SettingsLike {
    getGlobalSettings(): unknown;
    getProjectSettings(): unknown;
  }

  export class SettingsManager {
    static create(cwd: string, agentDir: string): SettingsLike;
  }
}
