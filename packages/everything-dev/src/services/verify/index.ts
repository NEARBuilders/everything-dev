// verify chain — the trust-chain walker and its failure formatter
export {
  type ChainDepth,
  formatChainFailures,
  type VerifyRemoteResult,
  type VerifyReport,
  verifyChain,
} from "./chain";
// engine — digest primitives and the verified-bytes fetch contract
export type {
  Digest,
  Verified,
  VerifiedBytes,
  VerifyCallOptions,
  VerifyError,
} from "./engine";
export {
  asDigest,
  clearVerifiedCache,
  computeSri,
  fetchVerified,
  isVerifyError,
  mark,
  Verifier,
  verifyDocument,
} from "./engine";
