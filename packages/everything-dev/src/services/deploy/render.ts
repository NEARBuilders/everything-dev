import { Context } from "effect";

/** One workspace bundle upload's outcome, for the Upload section (#431): the
 * train reports WHAT happened in target order; the renderer decides HOW it
 * shows (one line by default, detail behind --verbose). */
export interface UploadOutcomeRender {
  key: string;
  ok: boolean;
  /** the bundle base URL — undefined only for a no-op workspace */
  base?: string;
  uploaded?: number;
  skipped?: number;
  durationMs?: number;
  /** attributed detail lines (diff skips, manifest pin, source archive) —
   * shown only when verbose */
  detailNotes?: string[];
}

export interface PublishSectionRender {
  registryUrl: string;
  fingerprint: string;
  /** slot → pin line, in config order */
  slotPins: Array<[string, string]>;
  /** the per-deploy audit manifest's filename */
  auditManifestFile: string;
}

/**
 * The deploy train's presentation seam (#431): sections render through this
 * interface — Build reuses `WorkspaceBuildRender`, Upload/Publish flow through
 * here — so services never print and parallel units can never interleave.
 */
export interface DeployTrainRender {
  cdnBanner?(storageOrigin: string): void;
  uploadOutcome?(outcome: UploadOutcomeRender): void;
  publish?(info: PublishSectionRender): void;
}

export class DeployTrainRenderService extends Context.Service<
  DeployTrainRenderService,
  DeployTrainRender
>()("everything-dev/deploy/render") {}
