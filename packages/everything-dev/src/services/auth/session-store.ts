import { Context, Layer } from "effect";
import {
  deleteSessionHandle,
  nearCredentialsPath,
  readSessionHandle,
  removePublishedKeyFile,
  writeSessionHandle,
} from "./session";

/**
 * The `.bos/session.json` handle as a Context.Service tag (ticket #423): the
 * auth handlers yield the store instead of importing the session module
 * directly, keeping the login/logout flows swappable in tests.
 */

export class SessionStore extends Context.Service<
  SessionStore,
  {
    read: typeof readSessionHandle;
    write: typeof writeSessionHandle;
    delete: typeof deleteSessionHandle;
    removePublishedKeyFile: typeof removePublishedKeyFile;
    nearCredentialsPath: typeof nearCredentialsPath;
  }
>()("everything-dev/auth/session-store") {
  static readonly Live = Layer.succeed(
    this,
    SessionStore.of({
      read: readSessionHandle,
      write: writeSessionHandle,
      delete: deleteSessionHandle,
      removePublishedKeyFile,
      nearCredentialsPath,
    }),
  );
}
