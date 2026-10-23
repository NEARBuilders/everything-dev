import { Context } from "effect";

export type DevProcessStatus = "pending" | "starting" | "ready" | "error";

export interface DevProcessState {
  name: string;
  status: DevProcessStatus;
  port: number;
  message?: string;
  source?: string;
  uiPort?: number;
}

export interface DevLogLine {
  source: string;
  line: string;
  isError?: boolean;
}

export interface DevSessionState {
  description: string;
  proxyTarget?: string;
  processes: DevProcessState[];
  logs: DevLogLine[];
}

export interface DevRendererHandle {
  updateProcess: (name: string, status: DevProcessStatus, message?: string) => void;
  addLog: (source: string, line: string, isError?: boolean) => void;
  unmount: () => void;
}

export interface DevRendererOutput {
  write: (text: string) => void;
}

/**
 * The dev session's view seam (DIP): the session owns the process lifecycle
 * and pushes status/log events; the CLI supplies the terminal renderer
 * implementation. The interface is the render contract — a non-interactive
 * consumer can supply a no-op handle.
 */
export class DevRenderer extends Context.Service<
  DevRenderer,
  {
    create: (
      initialProcesses: DevProcessState[],
      description: string,
      env: Record<string, string>,
      requestShutdown: () => void,
      requestExportShutdown: () => void,
      options: { interactive: boolean; onForceExit: () => void },
    ) => DevRendererHandle;
  }
>()("bos/DevRenderer") {}
