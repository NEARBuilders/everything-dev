import { oc } from "@orpc/contract";
import { z } from "zod";

export const warningsContract = oc.router({
  ping: oc.route({ method: "GET", path: "/ping" }).output(z.object({ ok: z.boolean() })),
});
