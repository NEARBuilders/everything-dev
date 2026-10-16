import { Context, Layer } from "effect";
import { ensureCustodyBalance, submitRegistryWriteCustody } from "../../custody-signer";
import { ensureDelegateKey, submitRegistryWriteDelegated } from "../../delegate-signer";
import { fetchBosConfigFromFastKv, fetchConfigHistory } from "../../fastkv";
import { submitRegistryWrite } from "../../near-signer";
import { buildSourceArchive } from "../../source-archive";
import { collectDistFiles, uploadBundle, uploadWorkspaceDist } from "../../storage-upload";
import { composeWorkspaceVersionManifest, readBuildReport } from "../../version-manifest-deploy";
import { resolveSlotVersion } from "../../version-manifest-resolve";
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

export interface RegistrySignerShape {
  submitRegistryWrite: typeof submitRegistryWrite;
  submitRegistryWriteDelegated: typeof submitRegistryWriteDelegated;
  submitRegistryWriteCustody: typeof submitRegistryWriteCustody;
  ensureDelegateKey: typeof ensureDelegateKey;
  ensureCustodyBalance: typeof ensureCustodyBalance;
}

export class RegistrySigner extends Context.Service<RegistrySigner, RegistrySignerShape>()(
  "everything-dev/deploy/signer",
) {
  static readonly Live = Layer.succeed(
    this,
    RegistrySigner.of({
      submitRegistryWrite,
      submitRegistryWriteDelegated,
      submitRegistryWriteCustody,
      ensureDelegateKey,
      ensureCustodyBalance,
    }),
  );
}
