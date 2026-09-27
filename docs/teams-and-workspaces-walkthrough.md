# Teams and workspaces walkthrough

Date: 2026-09-21

The local databases were started with `docker compose up -d --wait`. The development stack was then started with:

```text
bun run dev --port 3100 --api-port 3101 --ui-port 3103 --auth-port 3102 --plugin-port-start 3110
```

The stack reached `APP READY` at `http://localhost:3100` with all eight services running: host, UI, API, auth, and the four local plugins. Auth migrations, including the wallet invitation fields, loaded successfully during boot.

The initial computer-use browser was unavailable. Chromium was subsequently installed with `bunx playwright install chromium`, and a headless Playwright walkthrough exercised the local development stack on `http://localhost:4100` using isolated regression databases. The stack used `CORS_ORIGIN=http://localhost:4100 RATE_LIMIT_WINDOW_MS=1000 RATE_LIMIT_MAX=100 CI=true bun run regression:dev:ssr`.

## Observed browser results

- Created an organization through the UI, then created Finance and Node Operator teams through the Teams tab.
- Saved distinct `finance` and `node-operations` grants through the area checkboxes.
- Invited an email user and a NEAR account through the unified form, targeting different teams.
- Accepted the email invitation from the organizations dashboard; the header and sidebar immediately reflected Finance.
- Observed the wallet invitation on the organizations dashboard with the wallet user's email deliberately unverified, then accepted it through the claim-link page; the workspace immediately reflected Node Operator.
- Both workspaces hid Things and redirected direct navigation to `/things` to `/dashboard?restricted=things`.
- A node mutation probe returned 403 for Finance. Node Operator passed the area gate and reached the handler, which returned 404 for a deliberately nonexistent UUID.
- Clearing the active team restored the full navigation for both users.
- An organization owner and a platform admin, each operating with Finance active, retained full navigation and passed the node API area gate.

The walkthrough used disposable local users. The wallet identity was linked in the isolated test database as a fixture, and the email identity was marked verified there. This checks wallet invitation ownership matching and browser integration; it does not test an external wallet's SIWN signature flow or delivery to a real mailbox. Local email delivery was preview-only. No GitHub issue comment was posted.

## Defects found and fixed during verification

- The browser regression's anonymous sign-in request omitted its JSON content type and received HTTP 415.
- Auth helpers converted native `Headers` with `Object.entries`, discarding cookies and causing team mutations through oRPC to fail with HTTP 401. Native headers now survive conversion, with a regression test.
- Better Auth rejects email-invitation listing for unverified emails. The combined query previously let that rejection hide linked-wallet invitations as well. Wallet discovery now works independently, with an integration regression.

## Automated validation

- Full UI suite: 63 files, 354 tests passed.
- Full API suite: 13 files, 116 tests passed.
- Wallet invitation integration suite: 10 tests passed; auth utility suite: 31 tests passed.
- Team workspace Playwright regression: passed after fixing the request headers.
- Final `bun typecheck`: all eight targets passed. Final `bun lint`: passed with warnings.
- The full root test command is not green: after Chromium installation, the host remote-runtime browser suite passed two tests but failed its navigation check because the deployed remote UI had no link named `Skill`; seven cases were skipped and one did not run. That suite targets the deployed remote UI, not the local team workspace.
- A broad auth-suite run also timed out in the session-revocation test and the NEAR sandbox setup hook. Rerunning those two files with `--maxWorkers=1` passed session revocation, but `Sandbox.start` still exceeded the 30-second setup timeout and its four SIWN tests did not run. External-wallet signature verification therefore remains unverified in this environment.

Automated acceptance coverage lives in `plugins/auth/tests/integration/near-invitations.test.ts`, `ui/src/routes/_layout/_authenticated/_dashboard/orgs/-invite-member-form.test.tsx`, and `tests/regression/browser/specs/team-workspace.spec.ts`.
