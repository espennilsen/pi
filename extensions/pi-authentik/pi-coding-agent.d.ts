declare module "@earendil-works/pi-coding-agent" {
  export interface ExtensionAPI {
    events: {
      emit(event: string, data?: unknown): void;
    };
    on(event: string, handler: (...args: any[]) => any): void;
    registerCommand(name: string, command: { description?: string; handler: (args: string | undefined, ctx: any) => Promise<void> | void }): void;
    registerProvider(name: string, provider: Record<string, unknown>): void;
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
