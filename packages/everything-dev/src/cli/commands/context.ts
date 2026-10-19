export interface CommandContext {
  client: any;
  input: any;
  descriptor: { key: string };
  projectDir?: string;
  configPath?: string | null;
  outdatedWarning: unknown;
}

export type CommandRunner = (ctx: CommandContext) => Promise<void>;
export type ResultRenderer = (result: any, ctx: CommandContext) => Promise<void> | void;
