# Step 7: release validation

Local validation passed on 2026-10-18. The overall release gate remains open:
there is no accepted Netlify testing deployment and no approved dependency-risk
exception. Do not begin step 8 or change production credentials.

## Evidence

- 58 automated tests pass. Astro check passed on 78 files without diagnostics
  before the final artifact-inspection helper and its two tests were added.
- Testing database migrations 001–006 and policy checks pass unchanged.
- Real testing R2/image/publication/migration probes pass, including recovery,
  idempotency, concurrency, access denial and fixture cleanup.
- Installed Edge exercised upload, direct HTTPS and no-photo submissions against
  testing Postgres/R2. Lost-response retry, resend/token replacement, scanner-safe
  GET, explicit POST confirmation and next-request directory publication pass.
  This harness injects bot verification and captures mail; it does not establish
  genuine Turnstile or email delivery acceptance.
- All 25 imported public profiles match approved source fields and stable URLs:
  14 processed photos, four unavailable-photo placeholders, seven without photos.
  Violet's correction is checked against its audit and current source bytes.
  Private history dry run: 24 records, no missing/duplicate/ambiguous mappings;
  no real historical email records were imported into testing. Leaf remains absent
  from that private source because her original email is unavailable.
- User-run build completed successfully at 21:35 Vancouver time. Only about,
  submit-profile and whats-next were prerendered; directory routes use SSR.
- Fresh artifact scan checked 387 text files, found no saved private values/files
  and no listed vulnerable/development package references in SSR output.
  Astro's build does not package the handwritten Netlify functions; that remains
  a separate deployed-artifact gate, including Linux Sharp execution.
- Audit remains 12 high and zero critical findings in unpatched braces/node-forge
  dependency chains. Absence from SSR output alone is not a security exception.

## Browser flow and maintenance

`/submit-profile` is request-time and testing-only. Both
`IMAGE_INGESTION_ENABLED=true` and `VERIFIED_SUBMISSIONS_ENABLED=true`, plus a
Turnstile site key, are required; otherwise it returns 503. This release branch
uses the new form at its normal URL; `/submit-profile-preview` redirects there.
Production on main keeps the legacy GitHub-review workflow until cutover.

`ProfileSubmissionPage.astro` shares the existing design. `submissionForm.ts`
initializes validation; `verifiedSubmissionForm.ts` prepares the private image,
retains one request identity for retries, and calls the existing server handlers.
Capabilities stay in memory. The server validates origin, bot action/hostname,
profile data and authorization independently of browser validation.
Confirmation removes the URL fragment and publishes only on explicit POST.
Replacement links now update the token even when opened in the same tab; stale
requests cannot overwrite the new link's UI state.

To repeat the native browser harness, stop other listeners on port 8888. In one
PowerShell terminal, temporarily enable both flags for the upstream process:

```powershell
$env:IMAGE_INGESTION_ENABLED='true'
$env:VERIFIED_SUBMISSIONS_ENABLED='true'
npm.cmd run dev -- --host 127.0.0.1 --port 4330
```

In another terminal, from webpage/, run `npm.cmd run test:browser` with the same
flags enabled. `.env` must retain `SITE_URL=http://localhost:8888` and valid testing
provider configuration. The harness owns a loopback proxy and isolated Edge
profile, stubs Turnstile only inside its test tab, captures synthetic mail, and
cleans its synthetic rows/objects. It never submits the legacy form or sends real
mail. `scripts/browser-driver.ts` requires installed Windows Edge; no Playwright
installation is needed. If interrupted, inspect synthetic leftovers before
rerunning. Remove temporary process flags afterward.

Run tests and Astro check before the build. Stop all dev/check processes, then
have the user run `npm.cmd run build` and `npm.cmd run validate:artifacts` locally.
Do not start Astro dev/check between build and inspection: the adapter clears
generated function output during configuration. The artifact scanner never runs
a build and suppresses private values in its report.

## Netlify testing branch setup

Use the existing Netlify project. Keep main as production. In project
configuration, Continuous deployment → Branches and deploy contexts, enable a
branch deploy specifically for `release/v1.0.1`. Review and commit/push the local
implementation before expecting that deployment to contain it. No push or
deployment was performed by this validation work.

Use repository-root settings (the Git repository is already webpage/): build
`npm run build`, publish `dist`, functions `netlify/functions`, supported Node 24.
Do not add another webpage base directory.

Configure branch-specific values using `.env.example` as the variable inventory:

- `APP_ENV=testing`, testing Supabase URL/restricted key/secret key, testing R2
  bucket-scoped credentials, testing public image domain, and all independent
  testing/production resource pins. Never inherit production provider credentials.
- `SITE_URL` equal to the branch deployment's exact HTTPS origin.
- Testing Turnstile site/secret keys with that hostname permitted. Enable both
  submission/image flags for the submission route. Keep cleanup/publication job
  flags off until their testing invocation is explicitly arranged.
- A separate verification secret, email provider key/from address, controlled
  `TEST_EMAIL_ALLOWLIST` and controlled `NOTIFICATION_EMAILS`. Every new-flow
  recipient, including administrators, must be allowlisted.

Keep server secrets scoped to server/build needs, never PUBLIC_ variables.
Do not upload `.env`, historical files, database connection URI or CA file.
The application does not need `TEST_DATABASE_URL` or its CA in Netlify.
Avoid supplying GitHub-writing credentials to this preview; do not use the
retired legacy endpoint to test deployment. Production's existing workflow stays unchanged.

Add the exact branch origin to testing temporary-bucket CORS while retaining
localhost:8888: PUT/GET/HEAD, allowed content-type, exposed ETag, max age 300.
Keep the bucket private: no r2.dev URL or custom domains. Preserve raw/ one-day
and processed/ seven-day lifecycle rules. Never loosen bucket privacy for testing.

## Deployed acceptance still required

At the branch URL, check static and runtime pages, no-store/error headers,
environment isolation and absence of private data. Inspect Netlify-packaged
custom functions/dependencies and run image processing on the deployed Linux
runtime. Resolve dependency findings or document a concrete reviewed risk decision
based on packaged exposure; no exception is approved here.

Use a synthetic profile and controlled allowlisted inbox at
`/submit-profile`. Exercise genuine Turnstile, upload/private preview,
confirmation delivery, scanner GET without publication, explicit confirmation,
resend cooldown/replacement link, administrator mail and next-request visibility.
Repeat direct HTTPS and no-photo paths. Record results and clean synthetic records
and assets through restricted operations, preserving imported profiles.

Branch deployments do not establish scheduled-function timer acceptance. Netlify
scheduled functions run on published deployments; provider probes establish the
recovery logic, not that a production timer has fired. Production backup/restore,
final submission reconciliation, credentials and timer activation belong to the
separate step 8 cutover, after release gates pass.

References: [branch deploys](https://docs.netlify.com/deploy/deploy-types/branch-deploys/),
[environment contexts](https://docs.netlify.com/build/environment-variables/overview/),
[scheduled functions](https://docs.netlify.com/build/functions/scheduled-functions/).
