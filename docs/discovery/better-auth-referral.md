# better-auth-referral vs. Onboarding Codes

Should citynode.app use [`@marinedotsh/better-auth-referral`](https://github.com/marinedotsh/better-auth-referral) for event QR onboarding with referral attribution?

**Short answer: no.** The plugin only attributes email and OAuth sign-ups. citynode users sign up with a passkey or SIWN. The QR-to-team flow the plugin would support already exists here as **Onboarding Codes** (`onboarding_code`), and a Onboarding Code already records the organizer who created it. If user-to-user referral becomes a priority later, add one nullable column to the Onboarding Code redemption.

Sources checked 2026-09-25. Plugin permalinks use commit `9f228d7` (`R` = `https://github.com/marinedotsh/better-auth-referral/blob/9f228d753c0177e9ab37edbb3c0ef484496a7ef8`). Better Auth facts come from the installed 1.6.25 sources in `node_modules/`.

## 1. What the plugin does

**Data model.** Three models are added to the Better Auth schema (`R/src/schema.ts#L7-L128`):

- `referralCode`: `userId` (unique FK to user), `code` (unique, exactly 8 characters `[A-Z0-9]`), `createdAt`. Each user has one code, and it belongs to that user. There is no per-event or per-campaign code (`R/src/schema.ts#L8-L36`, `R/src/helpers.ts#L46-L55`).
- `referrals`: `referrerUserId`, `referredUserId` (unique, so a user can be referred only once), `referralCodeId`, `status` (`pending` or `completed`), `completedAt`, `createdAt` (`R/src/schema.ts#L38-L91`).
- `referralStepCompletion`: `referralId`, `step`, `completionKey` (unique idempotency key), `metadata` (json), `completedAt` (`R/src/schema.ts#L93-L127`).

**Endpoints** (`R/src/routes/index.ts#L15-L21`, `R/README.md` "Endpoints"):

- `GET /referrals` (`getMyReferralDashboard`): returns your code and stats. It creates your code if you don't have one yet (`R/src/routes/referral-dashboard-summary.ts#L23-L45`).
- `GET /referrals/list-referrals` (`listReferrals`): paginated list with optional email masking.
- `POST /referrals/mark-referral-step-complete`: server-only, `createAuthEndpoint.serverOnly` (`R/src/routes/mark-referral-step-complete.ts#L40`).

**Client plugin.** Type inference only: `{ id, $InferServerPlugin }`, with no custom actions (`R/src/client.ts#L5-L9`).

**Attaching a code.** Two channels exist, and the key is configurable (`referralCodeKey`, default `x-referral-code`):

- Email sign-up: an `x-referral-code` request header.
- OAuth sign-up: `additionalData[key]` together with `requestSignUp: true` (`R/README.md` "How it works").

**Hooks and redemption.** Everything is endpoint-matched `hooks.before` / `hooks.after` (`R/src/server.ts#L272-L368`):

- A before-hook on `/sign-up/email`, `/sign-in/social` and `/sign-in/oauth2` checks that the code exists. An unknown code throws `BAD_REQUEST`, which fails the whole sign-up (`R/src/server.ts#L130-L155`, `#L273-L299`).
- An after-hook on `/sign-up/email`, `/sign-in/social`, `/callback/:id` and `/oauth2/callback/:providerId` reads `ctx.context.newSession.user` and calls `createReferral` (`R/src/server.ts#L302-L366`).
- For OAuth, a user counts as new only if `user.createdAt >= startedAt`, where `startedAt` is stamped into the OAuth state (`R/src/server.ts#L124-L128`).

`createReferral` does the rest (`R/src/server.ts#L157-L262`):

1. Skips self-referral and users who were already referred.
2. Inserts a `referrals` row with status `pending`.
3. Gives the new user their own code.
4. Records the built-in `sign_up` step. With no custom steps configured, that step completes the referral immediately.
5. Calls `afterSuccessfulSignUp`, swallowing any error it throws.

## 2. Maturity

| | |
|---|---|
| Version | 0.3.0, published 2026-07-31. There have been 3 npm releases: 0.1.0 (07-12), 0.2.0 (07-14), 0.3.0 (07-31) (`npm view @marinedotsh/better-auth-referral time`, `R/CHANGELOG.md`). There are no GitHub releases or tags. |
| Last commit | 2026-07-31, `9f228d7` "docs: clarify multi-step referral release" (`git log`). |
| Maintainers | One: Shivam Gupta (`shivamrun`), author of all 8 commits (`gh api …/contributors`, `R/package.json` `author`). |
| Adoption | 79 stars, 5 forks, 0 open issues. The repo was created 2026-07-12 (`gh api repos/marinedotsh/better-auth-referral`). |
| Tests | 43 vitest cases across `tests/helpers.test.ts` (14), `tests/server.test.ts` (18) and `tests/routes.test.ts` (11). None cover passkey, SIWN or `databaseHooks`; grepping for those terms finds nothing. |
| License | MIT (`R/LICENSE`). |
| Better Auth compat | Peer dependencies are `better-auth ^1.6.23` and `zod ^4` (`R/package.json` `peerDependencies`). This repo pins `better-auth` and `@better-auth/passkey` to `1.6.25` in the catalog (`package.json:29`, `package.json:31`; `node_modules/better-auth/package.json` shows 1.6.25). The versions are compatible. |

## 3. Passkey and SIWN sign-up are not covered

The plugin attaches to specific endpoint paths. It does not use `databaseHooks.user.create`. The only paths it matches are `/sign-up/email`, `/sign-in/social`, `/sign-in/oauth2` and the OAuth callbacks (`R/src/server.ts#L275`, `#L286`, `#L304`, `#L315`, `#L341-L342`).

**Passkey-first sign-up.** The user is created inside `/passkey/generate-register-options`, by our `resolveUser` callback (`plugins/auth/src/auth-instance.ts:314-331`, `node_modules/@better-auth/passkey/dist/index.mjs:22-48`, `:56`, `:150`). `/passkey/verify-registration` creates the passkey row but no session (`…/passkey/dist/index.mjs:380-383`). The client then calls `signIn.passkey()`, which creates the session (`packages/everything-dev/src/ui/auth.ts:176-219`, `…/passkey/dist/index.mjs:461-465`). None of these paths match the plugin's hooks, so no referral is recorded.

**SIWN.** New users are created in `/near/verify` via `internalAdapter.createUser` (`packages/better-near-auth/src/index.ts:1375-1376`, `:1514`). The plugin doesn't match that path either.

**Anonymous and phone OTP sign-ups** are also created off-path (`plugins/auth/src/auth-instance.ts:300-313`).

**Where a generic hook would go.** `internalAdapter.createUser` goes through `createWithHooks`, so `databaseHooks.user.create.after` fires for every sign-up path (`node_modules/better-auth/dist/db/internal-adapter.mjs:78-79`, `node_modules/better-auth/dist/db/with-hooks.mjs:6`). This repo already uses that hook to create a personal org (`plugins/auth/src/auth-instance.ts:494-505`). A database hook has no request context for reading a referral header, though. Passkey does offer a request channel: `generate-register-options` accepts a `context` query string, which is passed to `resolveUser` and to `registration.afterVerification` (`…/passkey/dist/index.mjs:50-54`, `:43-46`, `:197`, `:351-358`).

**Making the plugin work here would require forking it** to add matchers for `/passkey/*` and `/near/verify`, plus a new way to deliver the code, because neither path has a header or `additionalData` convention. That is most of the plugin.

## 4. One token for attribution and team invite

The plugin can't carry the team invite. Its code belongs to a user, and it has no org, team, expiry, use cap or revocation (`R/src/schema.ts#L8-L36`).

**Better Auth's built-in organization invitation is email-bound:**

- `POST /organization/invite-member` requires `email` (`node_modules/better-auth/dist/plugins/organization/routes/crud-invites.mjs:16-17`, `:42`).
- It supports `teamId` as a string or array, stored comma-joined (`…/crud-invites.mjs:21`, `:173-212`).
- `accept-invitation` throws `YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION` unless `invitation.email === session.user.email`, and it can require `emailVerified` (`…/crud-invites.mjs:246`, `:269`, `:274`). Get and reject apply the same check (`:380`, `:503`).
- It has no multi-use "anyone with this link" mode, so each invite is for one recipient.

Passkey users here get a synthetic `passkey-xxxx@<recipient>` email and SIWN users get a derived one (`plugins/auth/src/auth-instance.ts:320`, `packages/better-near-auth/src/index.ts:1508`). No organizer could know either address in advance, so native invites don't fit QR onboarding. This repo already works around the email binding for wallets with `nearInvitations`, which uses a synthetic email plus custom accept endpoints (`plugins/auth/src/near-invitations.ts:31-33`, `:122-216`; `plugins/auth/src/auth-instance.ts:355-409`).

**The flow already exists: the Onboarding Code** (commit `ad8c2ef9`, 2026-09-22, on `main`; `CONTEXT.md` "Event onboarding"):

- **Schema.** `onboarding_code` holds `codeHash` (SHA-256 of a 32-byte base64url token), `organizationId`, `eventName`, `teamId`, `role`, `maxUses`, `usedCount`, `expiresAt`, `revokedAt` and **`createdBy`**. `onboarding_redemption` holds `codeId`, `userId` and `createdAt`, unique on `(codeId, userId)` (`plugins/auth/src/db/schema.ts:278-321`, `plugins/auth/src/handlers/onboarding.ts:16-22`).
- **Routes.** create, list, revoke, status, info and redeem, under `/v1/auth/onboarding/*` (`plugins/auth/src/contract.ts:715-800`).
- **Redeem.** In one transaction it adds the org member, adds the team member, does a capped increment of `usedCount`, and inserts the redemption row. It then sets the session's active org and team (`plugins/auth/src/handlers/onboarding.ts:271-420`).
- **UI.** The organizer's QR encodes `/onboard?code=…` (`ui/src/routes/_authenticated/_dashboard/orgs/-onboarding-tab.tsx:65-66`). `/onboard` redeems automatically once any session exists, whether it came from passkey or NEAR (`plugins/auth/ui/src/routes/_public/onboard.tsx:23-29`, `:65-78`).
- **Auth-method independence.** Redemption runs after sign-in, not during it, so it works for passkey, SIWN, email and OAuth.
- **Organizer attribution.** Joining `onboarding_redemption` to `onboarding_code.createdBy` already records which organizer brought each member. `getOnboardingStatus` lists who joined through each code (`plugins/auth/src/handlers/onboarding.ts:195-243`).

**Remaining gaps:**

- There is no user-to-user referral, such as "Alice shared the organizer's QR".
- There is no flag for whether a redemption was a new sign-up. It can be derived by comparing `user.createdAt` with `onboarding_redemption.createdAt`.

## 5. Where a Better Auth server plugin would go

The auth server is **in this repo**, so we can add plugins here. In development, `bos.config.json` points auth at `local:plugins/auth` (`bos.config.json:45-52`). The Better Auth instance, including its plugin list and `databaseHooks`, is built in `plugins/auth/src/auth-instance.ts:255-527`. The schema and Drizzle migrations are in `plugins/auth/src/db/`. Production runs the deployed build of this same package, `@everything-dev/auth-plugin` 1.2.3 (`plugins/auth/package.json:1-3`, `bos.config.json:52`).

`AGENTS.md:477` still describes auth as "Extended remote plugin from `bos://auth.everything.near`". `bos.config.json` has no `extends` for it, and the source here is actively edited: commits `e682bc04`, `5ec019ad` and `a1e1cba8` touch `plugins/auth`. Any Better Auth plugin therefore lands in `auth-instance.ts`, plus a migration under `plugins/auth/src/db/migrations/`, followed by a redeploy of the auth remote.

## 6. Recommendation

**Don't adopt the plugin or fork it. Extend Onboarding Codes.**

- **Adopt:** doesn't work. The plugin never fires for passkey or SIWN sign-ups (§3), which are this app's main paths. Its fail-closed `BAD_REQUEST` on unknown codes would also block sign-up if we ever passed it a code on email sign-up (`R/src/server.ts#L150-L154`).
- **Fork:** you'd rewrite the hook layer and the code transport. What's left is three tables and a dashboard, and the project is a 2.5-month-old, single-maintainer 0.x release.
- **Build (minimal), if referral becomes a priority:**
  1. Add nullable `referred_by_user_id` to `onboarding_redemption`. Optionally add `was_new_user boolean`, set when `user.createdAt` falls within N minutes of redemption.
  2. Add an optional `ref` to the Onboarding Code URL (`/onboard?code=…&ref=<userId or short handle>`) and to `redeemOnboardingCode`'s input. Validate that `ref` is an existing member of the same org and isn't the redeemer.
  3. Put attribution on the redemption, not on sign-up. This keeps it independent of auth method and avoids hooks in the Better Auth pipeline.
  4. Report counts on the existing `getOnboardingStatus`.

  If multi-step "qualified referral" rewards are needed later, copy the plugin's `referralStepCompletion` idempotency-key design (`R/src/schema.ts#L93-L127`) instead of taking the dependency.
- **Naming:** keep "Onboarding Code" in code and UI, and avoid "referral link" (`CONTEXT.md` "Onboarding Code" `_Avoid_`).
- **Unrelated gap found:** `CONTEXT.md` says members of a Team granted the events Feature Area are **Organizers**. The handler currently allows only org owners and admins to manage codes (`plugins/auth/src/handlers/onboarding.ts:57-62`).
