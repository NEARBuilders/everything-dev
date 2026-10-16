/**
 * Thin facade (ticket #426): the command meta now lives in the contract —
 * the one flag/command source. Re-exports keep the `./contract.meta`
 * subpath and internal imports stable.
 */
export { type CliCommandMeta, cliCommandMeta } from "./contract";
