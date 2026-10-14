import { Context, Effect } from "effect";
import { attemptAuth } from "../attempts";
import type { InferOutput } from "../contract";
import { toPasskey } from "../serializers";
import type { PluginServices } from "../service-types";
import type { AuthFailure } from "./domain-errors";

type Auth = PluginServices["auth"];

export class PasskeysService extends Context.Service<
  PasskeysService,
  {
    listUserPasskeys: (
      headers: Headers,
    ) => Effect.Effect<InferOutput<"listUserPasskeys">, AuthFailure>;
  }
>()("auth/PasskeysService") {}

export const buildPasskeysService = ({ auth }: { auth: Auth }) =>
  PasskeysService.of({
    listUserPasskeys: (headers) =>
      attemptAuth(() => auth.api.listPasskeys({ headers })).pipe(
        Effect.map((result) => (result ?? []).map(toPasskey)),
      ),
  });
