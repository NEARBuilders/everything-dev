import { Context, Layer } from "effect";
import { buildSourceArchive } from "../../source-archive";
import { collectDistFiles, uploadBundle, uploadWorkspaceDist } from "../../storage-upload";
import { composeWorkspaceVersionManifest, readBuildReport } from "../../version-manifest-deploy";
import { resolveSlotVersion } from "../../version-manifest-resolve";
import { fetchBosConfigFromFastKv, fetchConfigHistory } from "../registry/fastkv";
import type { StorageLegDeps } from "./upload-leg";

/**
 * The train's I/O surfaces as Context.Service tags (ticket #422): storage,
 * registry reads, and signing are injectable — tests provide fake layers,
 * the CLI composes the real ones in plugin.ts. The train core receives them
 * as a `TrainDeps` struct; `DeployTrainService.Live` resolves the tags.
 */

export class BundleStorage extends Context.Service<BundleStorage, StorageLegDeps>()(
  "everything-dev/deploy/storage",
) {
  static readonly Live = Layer.succeed(
    this,
    BundleStorage.of({
      collectDistFiles,
      uploadWorkspaceDist,
      uploadBundle,
      resolveSlotVersion,
      readBuildReport,
      composeWorkspaceVersionManifest,
      buildSourceArchive,
    }),
  );
}

export interface RegistryStoreShape {
  fetchConfig: typeof fetchBosConfigFromFastKv;
  fetchHistory: typeof fetchConfigHistory;
}

export class RegistryStore extends Context.Service<RegistryStore, RegistryStoreShape>()(
  "everything-dev/deploy/registry",
) {
  static readonly Live = Layer.succeed(
    this,
    RegistryStore.of({
      fetchConfig: fetchBosConfigFromFastKv,
      fetchHistory: fetchConfigHistory,
    }),
  );
}
