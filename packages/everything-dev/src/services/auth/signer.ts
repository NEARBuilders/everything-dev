import { Context, Layer } from "effect";
import type { CustodyWalletRecord, SessionCredential } from "../../auth-session";
import { ensureCustodyBalance, submitRegistryWriteCustody } from "../../custody-signer";
import { ensureDelegateKey, submitRegistryWriteDelegated } from "../../delegate-signer";
import { type SigningStrategy, submitRegistryWrite } from "../../near-signer";
import { colors } from "../../utils/theme";
import type { NetworkId } from "../registry/fastkv";
/**
 * The signing strategies as one Context.Service (ticket #423): the publish
 * train's custody / wallet-delegate / plain-key dispatch lives here instead
 * of inline in the train. The auth handles arrive pre-validated (preflight
 * guards once per run); the service dispatches and logs the strategy.
 */

export interface SignerServiceShape {
  submitRegistryWrite: typeof submitRegistryWrite;
  submitRegistryWriteDelegated: typeof submitRegistryWriteDelegated;
  submitRegistryWriteCustody: typeof submitRegistryWriteCustody;
  ensureDelegateKey: typeof ensureDelegateKey;
  ensureCustodyBalance: typeof ensureCustodyBalance;
  submit: (input: SubmitMode) => Promise<SubmitOutcome>;
}

export type SubmitMode =
  | {
      mode: "custody";
      account: string;
      contract: string;
      args: Record<string, string>;
      custodyWallet: CustodyWalletRecord;
      idempotencyKey: string;
    }
  | {
      mode: "wallet";
      account: string;
      contract: string;
      network: NetworkId;
      args: Record<string, string>;
      credential: SessionCredential;
      configDir: string;
    }
  | {
      mode: "key";
      account: string;
      contract: string;
      network: NetworkId;
      args: Record<string, string>;
      privateKey?: string;
      strategy: SigningStrategy;
    };

export interface SubmitOutcome {
  success: boolean;
  txHash?: string;
}

/** The strategy dispatch, exported for the train's procedural deps. */
export const dispatchSubmit = (input: SubmitMode): Promise<SubmitOutcome> =>
  input.mode === "custody"
    ? (async () => {
        await ensureCustodyBalance(input.custodyWallet);
        console.log(
          `  Signing via ${colors.cyan(`OutLayer custody wallet ${input.custodyWallet.nearAccountId}`)}`,
        );
        return submitRegistryWriteCustody({
          contract: input.contract,
          args: input.args,
          custodyWallet: input.custodyWallet,
          idempotencyKey: input.idempotencyKey,
        });
      })()
    : input.mode === "wallet"
      ? (async () => {
          const record = await ensureDelegateKey({
            configDir: input.configDir,
            account: input.account,
            contract: input.contract,
            network: input.network,
            siteUrl: input.credential.siteUrl,
          });
          return submitRegistryWriteDelegated({
            account: input.account,
            contract: input.contract,
            network: input.network,
            args: input.args,
            delegatePrivateKey: record.privateKey,
            relayEndpoint: `${input.credential.siteUrl}/api/auth/near/relay`,
            apiKey: input.credential.apiKey,
          });
        })()
      : submitRegistryWrite(
          {
            account: input.account,
            contract: input.contract,
            method: "__fastdata_kv",
            args: input.args,
            network: input.network,
            privateKey: input.privateKey,
          },
          input.strategy,
        );

export class SignerService extends Context.Service<SignerService, SignerServiceShape>()(
  "everything-dev/auth/signer",
) {
  static readonly Live = Layer.succeed(
    this,
    SignerService.of({
      submitRegistryWrite,
      submitRegistryWriteDelegated,
      submitRegistryWriteCustody,
      ensureDelegateKey,
      ensureCustodyBalance,
      submit: dispatchSubmit,
    }),
  );
}
