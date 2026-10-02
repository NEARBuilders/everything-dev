import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Output from "alchemy/Output";
import * as RemovalPolicy from "alchemy/RemovalPolicy";
import * as Effect from "effect/Effect";

// The CDN domain belongs to the base runtime — cdn.everything.dev for the
// everything.dev base; a sovereign base overrides it via env.
export const BUNDLE_CDN_DOMAIN = process.env.BOS_BUNDLE_CDN_DOMAIN ?? "cdn.everything.dev";

const bucketName = process.env.BOS_STORAGE_BUCKET ?? "everything-bundles";

export default Alchemy.Stack(
  "CityNodeInfra",
  {
    providers: Cloudflare.providers(),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    const { accountId } = yield* Cloudflare.CloudflareEnvironment;

    const bucket = yield* Cloudflare.R2.Bucket("Bundles", {
      name: bucketName,
      domains: [{ name: BUNDLE_CDN_DOMAIN }],
    }).pipe(RemovalPolicy.retain());

    const s3Token = yield* Cloudflare.ApiToken.AccountApiToken("BundlesS3", {
      name: "everything-bundles-s3",
      accountId,
      policies: Output.map(bucket.id, (bucketId) => [
        {
          effect: "allow" as const,
          permissionGroups: [
            "Workers R2 Storage Bucket Item Read",
            "Workers R2 Storage Bucket Item Write",
          ],
          resources: {
            [`com.cloudflare.edge.r2.bucket.${accountId}/${bucketId}`]: "*",
          },
        },
      ]),
    });

    return {
      bucketName,
      domain: BUNDLE_CDN_DOMAIN,
      s3Endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      s3Region: "auto",
      s3AccessKeyId: s3Token.tokenId,
      s3SecretAccessKey: s3Token.value,
    };
  }),
);
