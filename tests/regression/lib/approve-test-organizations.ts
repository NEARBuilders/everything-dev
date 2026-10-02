import { inArray } from "drizzle-orm";
import { organization } from "../../../plugins/auth/src/db/schema";
import { createAuthTestInstance } from "./auth-test-instance";
import { computeRegressionEnv } from "./regression-env.mjs";

const ids = process.argv.slice(2);
if (!ids.length) throw new Error("Organization fixture ids are required");
const env = computeRegressionEnv();
const fixture = await createAuthTestInstance({
  authDatabaseUrl: env.dbUrls.AUTH_DATABASE_URL,
  secret: env.authSecret,
});
try {
  await fixture.db
    .update(organization)
    .set({ status: "active" })
    .where(inArray(organization.id, ids));
} finally {
  await fixture.close();
}
