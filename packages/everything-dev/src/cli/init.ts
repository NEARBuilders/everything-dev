/**
 * Thin facade (ticket #426): the scaffold logic lives in services/scaffold/.
 * The `./cli/init` subpath and internal imports stay stable.
 */
export * from "../services/scaffold/init";
