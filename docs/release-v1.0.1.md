# v1.0.1 release foundation and setup runbook

## Status

Step 1 repository preparation is implemented. On 2026-10-18 the user reported
Supabase/R2/Turnstile setup, scoped R2 credentials, private temporary buckets,
production variables in Netlify, and isolated test administrator email recipients.
GitHub branch protections are explicitly deferred by the user and are not a gate.
Local configuration names are populated and .env/.env-prod are Git-ignored;
cloud connectivity and policies have not been independently tested.
Step 2 implementation and testing validation are recorded below. Read
[the implementation handoff](v1.0.1-implementation-handoff.md) before continuing.
Steps 3 and 4 are now implemented and validated in testing as recorded below. Step 5
requires a new user request.
No new backend behavior is enabled. Existing submissions still create PRs against
`staging` and send administrator emails through Resend.

## Baseline provenance

Inspection on 2026-10-13 found:

| Reference | Local observation |
| --- | --- |
| `release/v1.0.1` | Already exists; starts at `586040c1dd9c79ed5cc0a123a7a1095be898173a` |
| `main` and cached `origin/main` | `5b28648a73d83b8b3f884487c65bc6648cb19203` |
| `staging` | `586040c1dd9c79ed5cc0a123a7a1095be898173a` |
| Existing `v1.0.0` | Lightweight tag pointing to `5b28648a73d83b8b3f884487c65bc6648cb19203` |
| Production baseline | Accepted as `5b28648`: user confirms Netlify deploys main; main and v1.0.0 match locally |

The release branch contains a later profile-image fix; preserve it.

On 2026-10-17 the user confirmed Netlify deploys main. The existing tag is retained
as the baseline; no separate deployment evidence is required for this step.
It is lightweight, so Git records its target commit date (2026-10-11), not when
the tag was created. Its creation date cannot be recovered from the available
local history. The changelog records 2026-10-13 as the release date. Do not
replace that date with the commit date or rewrite the existing tag. Use annotated
tags for future releases.

The user has since created testing/production Supabase projects and R2 buckets.
The names below remain suggested names; obtain actual identifiers from local
configuration without printing credentials. Photo-domain/account arrangements
were discussed but the final arrangement has not been explicitly recorded.

Keep package.json and package-lock.json unchanged at `0.0.1` during foundation
work; set both to `1.0.1` as part of the tested final release. The existing package
version discrepancy is documented, not evidence that the baseline is invalid.
The v1.0.0 changelog entry is already present.

## Branches and protection

- Keep `main` production-ready. Feature PRs target `release/v1.0.1`; the release
  PR targets `main`. Squash individual features; use merge commits between
  persistent/release branches.
- Keep `staging` and `artist-submission/*` operational until cutover. Do not reset
  or recreate staging, and do not deploy unfinished release code to production.
- Urgent hotfixes start at main; merge main back into staging and the release
  branch regularly. Reconcile pending artist PRs before the final import.
- GitHub branch protections are deferred by explicit user decision. Continue
  reviewing changes and running tests/type checks; do not require protection
  setup before proceeding or modify repository settings without a new request.
- Run `npm.cmd test` and `npm.cmd run astro -- check` before merging. Production
  builds are run locally by the user or by Netlify, never inside the Codex sandbox.
- At cutover repurpose persistent staging for software integration, synchronize
  main back into persistent branches, and retain database/image source of truth.

## Resource setup

Create or identify the following resources, using the proposed names when new.
Record actual non-secret names and Supabase project references after setup.

| Resource | Testing | Production | Verification |
| --- | --- | --- | --- |
| Supabase project | `larparts-testing` | `larparts-production` | Pending |
| Private temporary R2 bucket | `larparts-testing-temporary` | `larparts-production-temporary` | Pending |
| Published R2 bucket | `larparts-testing-published` | `larparts-production-published` | Pending |
| Public image domain | Testing-only image subdomain | Production image subdomain | Pending: domain ownership/configuration |
| Turnstile widget | Testing/local hostnames | Production hostnames | Pending |
| Resend sender/recipients | Controlled test mailboxes | Verified sender and administrator recipients | Existing integration; delivery/setup not verified |

Use separate Supabase projects, not two schemas in one project. Use R2 Standard
storage, separate environment credentials, and bucket-scoped Object Read & Write
tokens (separate credentials for temporary and published buckets). No application
credential needs authority to administer all buckets.

Keep temporary buckets private: no custom domain or public r2.dev access. Published
buckets contain only validated public photos and use their own custom domains;
leave r2.dev disabled. Connecting a custom domain makes those bucket objects
public, so never connect one to temporary storage. Configure browser-upload CORS
and cleanup rules in step 3, when the upload contract is implemented.

Use synthetic profiles/emails in testing. Do not import historical production
emails into previews. Preview access should be restricted while new backend
features are under development. Provide isolated mail configuration: testing
verification mails must use controlled mailboxes, never real artists.

## Environment variable contract

The step 2 server modules enforce these contracts when invoked. They are not yet
wired into the current pages or submission function. `.env.example` also lists six
independent resource pins, plus testing-only database URI/certificate settings.

| Variables | Purpose |
| --- | --- |
| `APP_ENV`, `SITE_URL` | testing/production marker and canonical application URL |
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` | Project URL and RLS-restricted public-read client key; keep client instantiation server-side initially |
| `SUPABASE_SECRET_KEY` | Privileged server operations; never render or log |
| `R2_ACCOUNT_ID` | Builds the S3 API endpoint |
| `R2_TEMPORARY_BUCKET`, `R2_TEMPORARY_ACCESS_KEY_ID`, `R2_TEMPORARY_SECRET_ACCESS_KEY` | Private upload/preview bucket and scoped credentials |
| `R2_PUBLISHED_BUCKET`, `R2_PUBLISHED_ACCESS_KEY_ID`, `R2_PUBLISHED_SECRET_ACCESS_KEY` | Published-photo bucket and scoped credentials |
| `R2_PUBLIC_BASE_URL` | Custom-domain base URL for durable public photos |
| `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | Public widget identifier and private server verification key |
| `EMAIL_PROVIDER_API_KEY`, `FROM_EMAIL`, `NOTIFICATION_EMAILS` | Existing Resend server integration; environment-specific values |

Preserve existing GitHub variables until cutover. Netlify provides CONTEXT and
deployment URLs, but those are not substitutes for securely scoped resources.

Set production values only in Netlify's **Production** context. Set testing values
for **Deploy Previews** and applicable **Branch deploys**, including the release
branch. Never put production secrets in an all-context default. Use function
scope for secrets needed by request handlers; only expand scope when a concrete
server-rendering deployment requires it. Do not put secrets in netlify.toml or
variables prefixed PUBLIC_. Use testing-only values in ignored local .env files.

Existing v1 preview functions can still write GitHub PRs if real GitHub credentials
are provided. Restrict these to production/current workflow contexts; preview
testing must use mocks or a disposable repository rather than the live staging
branch. No current application code automatically enforces this separation.

## Step 1 external acceptance checklist

- [x] Accept existing v1.0.0 baseline at `5b28648`, matching main and the user-confirmed deployment configuration.
- [x] GitHub protections explicitly deferred by the user; not a step 1 blocker.
- [x] User reports testing and production Supabase projects created.
- [x] User reports R2 buckets created and credentials restricted to their buckets.
- [x] User reports temporary buckets unchanged from private defaults.
- [x] User reports production variables configured in Netlify.
- [x] User reports Turnstile configured; test administrator mail goes only to the user, production mail to the collaborator.
- [x] Local .env and .env-prod are ignored; all 18 expected local configuration names are populated.
- [ ] Exercise testing connections and permission boundaries during step 2; confirm
  final domain/account arrangement and preview scoping before enabling new endpoints.
- [x] Record automated test/type-check results in the step tutorial: 23 tests
  passed; Astro check passed across 25 files with zero errors/warnings/hints after
  rerunning outside the sandbox to resolve denied dependency reads.

Record resource identifiers and check results, never credential values or private
email mappings. A written setup procedure does not prove resources were created.

## Step 2 verified results — 2026-10-18

Implemented migration, public profile adapter, validated server configuration,
separate R2 clients/URL resolution, and audited dashboard SQL procedures. See
[database/storage operations](database-storage-operations.md) for commands and
administration examples. No current pages, profile JSON, styles, submission
function, or branch history changed. No production resources were mutated.

| Resource | Testing actual identifier | Production configured identifier (not exercised) |
| --- | --- | --- |
| Supabase project reference | `wwipkyfbcbjpqdailaix` | `bamrkpanccaifapzsfmq` |
| Temporary bucket | `larparts-testing-temporary` | `larparts-production-temporary` |
| Published bucket | `larparts-testing-published` | `larparts-production-published` |
| Public image origin | `https://images-testing.larparts.com` | `https://images.larparts.com` |

- Applied `202610180001_foundation.sql` to testing via verified-TLS session pooler.
  Reran the migration runner: matching checksum skipped DDL; tests passed again.
- Live SQL tests passed: published-only anonymous/authenticated reads, client
  write denial, private-table denial, normalized identity uniqueness, private-field
  rejection, safe future grants, audit actor/reason enforcement, unpublish,
  restoration and stale-revision rejection. Fixtures were rolled back.
- Restricted-key Data API public reads passed; private schema API access denied.
- Live R2 tests passed: own-bucket read/write, both directions of cross-bucket
  read/write/delete denial, unsigned temporary S3 rejection, public domain delivery,
  and cleanup verified by HEAD returning 404. Standard storage requested on probes.
  Cloudflare returns HTTP 400 InvalidArgument for missing Authorization; the test
  explicitly checks that error rather than accepting arbitrary failures.
- User explicitly confirmed testing temporary bucket has no custom domains and
  Public Development URL is disabled. This is dashboard confirmation, not an
  independently queried Cloudflare management setting.
- Local testing URL origins and six non-secret resource pins were normalized;
  credential values preserved. Root certificate, `.env` and `.env-prod` remain
  ignored. Do not copy testing database credentials into Netlify.
- Automated suite: 28 tests passed, including actual local PostgreSQL via PGlite
  (not mocked SQL). Astro check: 32 files, zero errors/warnings/hints. Sandbox
  dependency/network restrictions required elevated provider/check commands.
- No build run. No later step implemented.

Testing database/storage foundation checks pass. Production connectivity, actual
Netlify context-variable scoping, and production custom-domain/security settings
remain unverified and block enabling/deploying the new backend. Tests prove the
configuration rejects known resource swaps; they do not inspect Netlify settings.
Keep these open gates separate from the testing checks above. Branch protections
remain deferred as previously agreed. The step tutorial is outside Git at
`../summary_notes/02-database-and-storage.md`. Pause before step 3.

## Step 3 verified results — 2026-10-18

The testing image pipeline accepts an upload, a direct HTTPS image link, or no
photo. It creates metadata-free, orientation-corrected, bounded WebP copies in
private temporary storage, with capability-authenticated short-lived previews.
The current v1 form/pages and GitHub submission flow remain unchanged.

See [image ingestion operations](image-ingestion-operations.md) for exact contracts,
setup and manual walkthrough. Tutorial: `../summary_notes/03-image-ingestion.md`.

- Added `202610180002_image_ingestion.sql`; applied only to testing. The migration
  runner now discovers ordered SQL files and checks existing checksums. Matching
  reruns and live step 2/3 SQL policy tests passed.
- 36 automated tests passed. Tests exercise real local PostgreSQL access/leases/
  cleanup protection plus image decoding, private-address rejection, redirect
  revalidation, mixed DNS answers, streamed limits and HTTP authorization boundaries.
- Astro check passed across 41 files with zero errors/warnings/hints.
- Live upload and direct-HTTPS processing produced valid private WebP previews;
  orientation/dimensions, absent EXIF, wrong capability denial and expired signed
  GET denial were verified. Reusing a valid raw PUT URL could not change the
  processed preview or asset identity. Upload MIME/byte length were signature-bound;
  a changed MIME header was rejected with HTTP 403.
- Real R2 CORS preflights/preview delivery allowed `http://localhost:8888` and did
  not grant access to an unapproved origin. User confirmed the testing temporary
  bucket's CORS and `raw/` one-day / `processed/` seven-day lifecycle rules saved.
  Automatic lifecycle expiry has not been observed over elapsed days.
- Manual invocation of the cleanup service removed expired synthetic session
  objects and records; empty-prefix listings were verified. The synthetic HTTPS
  source was also removed from the testing published bucket. No production writes.
- The hourly Netlify scheduled function and image endpoint default off via
  `IMAGE_CLEANUP_ENABLED`/`IMAGE_INGESTION_ENABLED`. The endpoint also rejects
  production mode until the later rollout. No real Turnstile/browser integration,
  deployed schedule invocation or Linux native packaging is claimed verified.
- No build or deployment performed. Actual Netlify environment scoping and
  production setup remain open deployment gates. Tests used trusted server calls
  for live processing; bot/HTTP denials were checked in automated boundary tests.

Step 3 testing pipeline gate passes. Before step 4 publication can use these
assets, atomically bind capability/readiness/expiry to one submission and
coordinate session locks with cleanup. Promote into a distinct published object
within the temporary lifecycle retention window. Do not authorize publication
from an arbitrary browser-supplied asset ID. Pause before step 4.

## Step 4 verified results — 2026-10-18

Implemented the opt-in verified submission API, explicit confirmation page,
token/resend controls, atomic image binding, recoverable publication, durable
notification jobs and quarantined orphan cleanup. See
[verification/publication operations](verification-publication-operations.md) for
contracts and maintenance. Tutorial: `../summary_notes/04-verification-and-publication.md`.

- Applied migrations 003–005 only to testing. 004/005 correct SQL alias collisions
  with PL/pgSQL record variables without editing already-applied migration files.
  Existing foundation/image migration checksums are unchanged.
- 41 automated tests passed, including actual local PostgreSQL policy/lifecycle
  tests, expiry/resend revocation, idempotent submission, scanner-safe GET,
  concurrent publication, failure recovery, duplicate identity, orphan quarantine/
  exclusive cleanup and bounded notification retries. Astro check: 49 files,
  zero errors/warnings/hints.
- Live testing DB/R2 checks passed: wrong-capability/used-image binding denial,
  retry identity, concurrent confirmation, failure after R2 promotion before
  database commit, lost commit response, exactly one profile/administrator event,
  duplicate conflict, orphan deletion and retention of the committed image.
- Resend accepted one confirmation and one administrator notice for allowlisted
  testing recipients. User explicitly confirmed inbox receipt of both. Their
  synthetic links/records were cleaned up. Subsequent storage/database debug
  reruns used `--skip-mail` and sent no further messages.
- Generated the ignored local testing verification secret; preserved existing
  credentials. Corrected the local allowlist variable name to TEST_EMAIL_ALLOWLIST
  without printing/changing its addresses. All new-flow deliveries enforce that
  list, including administrator notifications.
- Synthetic records, audit fixtures, notification jobs, temporary copies and
  promoted test objects were removed. No private historical data imported.
- New endpoints/jobs remain default-off/testing-only. No current public form,
  JSON profile, artist URL or legacy GitHub review behavior changed. No accounts,
  ownership/claims, production writes, build or deployment performed.

Testing publication gate passes. Actual Netlify variable scoping, production
configuration, deployed scheduled-job invocation, native packaging and a genuine
browser Turnstile/form walkthrough remain unverified deployment acceptance gates.
The user-confirmed inbox receipt does not substitute for that browser walkthrough.
Current JSON pages cannot yet render new database profiles; that is step 5.
Keep runtime flags off on deployed sites pending those gates and the later
cutover. Pause before step 5.

## Step 5 verified results — 2026-10-18

Request-time homepage, directory, kingdom and profile routes now read published
Supabase data with the restricted key. Extracted page components retain existing
layouts, IDs/URLs, metadata and filter hooks. Informational pages remain static.
All dynamic responses disable browser/CDN/Netlify HTML caching; missing records
return 404 and backend/configuration failures return themed 503 responses.
See [live rendering operations](live-rendering-operations.md) and
`../summary_notes/05-live-rendering.md`.

- 46 automated tests passed. Astro check: 60 files, zero diagnostics (elevated
  rerun after sandbox dependency reads were denied).
- Real testing HTTP checks passed next-request publish/unpublish visibility,
  directory sorting/filter data, kingdom membership/discovery/removal, stable
  profile URLs/metadata, escaped biography, 404s, no-store headers, no session
  cookies and configured-secret exclusion. A second server with an invalid
  project pin returned friendly 503s on all public routes. Provider failures
  and malformed rows were separately covered in automated tests.
- Both synthetic profiles/audit fixtures were removed. No emails/images,
  production writes, import, build or deployment occurred. The legacy submission
  form still uses GitHub review; new-flow flags remain off/testing-only.
- Compatible dependency fixes updated Astro to 6.4.8 with Netlify adapter 7.0.13.
  Audit still has 16 advisories (1 low, 14 high, 1 critical), including Astro.
  A coordinated patched framework/adapter major upgrade and revalidation is a
  release blocker. Image CDN is disabled; that does not resolve the entire audit.
- Local user-run build, deployed variable/edge/header/packaging checks, browser
  visual/filter acceptance and complete verified-submission browser wiring remain
  unverified release gates. Legacy profiles are not imported yet; do not deploy
  these reads before migration and acceptance. Pause before step 6.

## Step 6 verified results — 2026-10-18

- Applied checksummed migration 006 only to testing. Added private profile import
  receipts, SQL-only prepare/commit/abandon controls, factual historical records,
  repeatable dry-run/apply/verification tools and safe photo follow-up reports.
- At the user's request fetched staging 1318445 and merged it locally into the
  release branch as cc99f7e. Two new public JSON profiles were added; the release
  image fix and all uncommitted work were retained. No push/reset/deletion.
- The first testing import contained 23 profiles; the merged source introduced
  two more without updating the first 23. Final verification matched all 25
  source profiles/fields/stable artist HTTP URLs and directory/kingdom links.
  13 processed photos passed stored/public digest, dimensions and metadata-removal
  comparisons; five unusable sources use placeholders; seven had no source photo.
- A complete apply rerun reported 25 unchanged. Live synthetic tests proved
  recovery after R2 accepted a write but its response was lost, source-unavailable
  resume, private-history null consent/idempotency, edit/unpublish preservation,
  duplicate conflict and abandonment. Synthetic records/assets were removed;
  the real public rehearsal profiles/photos remain in testing for walkthrough.
- User has no historical private source file. Only synthetic example.invalid
  records were tested. Public migration does not require inventing private data;
  retaining original private history requires a securely supplied factual source.
  No accounts, ownership, verification/notification jobs or claim eligibility
  were created by importing legacy profiles.
- Final post-merge suite: 53 tests passed. Astro check: 68 files, zero diagnostics.
  Live SQL policy/checksum tests passed again against populated testing; fixtures
  rolled back. No applied SQL migration checksum changed.
- Tutorial: `../summary_notes/06-migration.md`. See
  [migration operations](legacy-migration-operations.md) for commands, five photo
  follow-ups, private file format/location, recovery and maintenance.
- No production mutation/import, build or deployment. Browser upload/verification
  form wiring, full acceptance, dependency risk and deployed/native packaging
  remain release gates. User reported the current live-render view mostly looked
  good; no unprovided build log is claimed verified. Pause before step 7.

## Final release and rollback requirements

After rehearsal the user confirmed Violet.jpg for artist-6b95f0ac94c38a47.
Corrected the public JSON source and applied an audited revision-checked testing
photo assignment. Public image digest/delivery and three source tests passed.
Current photo totals: 14 copied, four placeholders, seven without photos. The
original receipt remains; Violet's source-change/baseline warning is intentional.
No production change. See migration operations for the correction record.

Step 5 dependency-maintenance follow-up: Astro 7.4.0 / Netlify adapter 8.2.10 now
pass 47 tests and Astro check on 61 files (no diagnostics), validated with Node
24.22.0. Project minimum is 22.22.0. A scoped IPX override deduplicates patched
Sharp 0.35.5, with actual JPEG/PNG/WebP transformation regression coverage.
Astro 7 HTTP next-request publication/unpublishing and friendly outage/header
checks passed, and synthetic fixtures were removed. No unreviewed install
scripts remain. The earlier critical Astro findings are resolved; the current
audit has 12 high, zero critical findings in unpatched braces/node-forge chains.
See [dependency maintenance](dependency-maintenance.md) for reviewed exposure and
remaining artifact/risk checks. No exception or passing security gate is claimed.
User-run build, generated artifact review and testing deployment remain open;
no build/deployment/production mutation occurred. Step 6 remains paused.

Later steps must provide tested migrations, publication recovery, private-data
policies, image validation, live pages, and repeatable imports before deployment.
Freeze and reconcile old submissions; back up Supabase and R2; import final data;
then deploy through the reviewed release PR. Set package and lock versions to
1.0.1, date the changelog, and tag the actual accepted release commit.
Revoke GitHub-writing credentials only after the rollback window permits it.
After cutover, rollback must preserve new Supabase records and R2 assets; the old
JSON snapshot is a read-only emergency fallback.

## Provider references

- [Netlify environment variables and contexts](https://docs.netlify.com/build/environment-variables/overview/)
- [Supabase API keys](https://supabase.com/docs/guides/getting-started/api-keys)
- [R2 public buckets and custom domains](https://developers.cloudflare.com/r2/buckets/public-buckets/)
- [R2 presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/)

## Step 7 local validation checkpoint � 2026-10-18

58 tests pass. Astro check passed on 78 files without diagnostics before the
final artifact helper and two tests were added. Testing database/storage/image/
publication/migration probes and installed-Edge upload/HTTPS/no-photo flows pass.
The browser harness captures mail and injects bot verification; genuine deployed
provider acceptance remains pending. Imported public data verifies at 25 profiles,
14 copied photos, four placeholders and seven without photos, including the
explicit audited Violet correction. Private history dry run passes for 24 records;
no personal history was imported into testing.

User-run build completed at 21:35 Vancouver time. Fresh output inspection scanned
387 text files: static/runtime split passes; no saved private values or listed
vulnerable/development SSR package references found. Netlify custom-function
bundles and Linux runtime have not been accepted. Audit remains 12 high, zero
critical; no risk exception is approved. No deployment or production write ran.

See [validation operations](release-validation-operations.md) for branch setup,
remaining gates and walkthrough, and `../summary_notes/07-validation.md` for the
tutorial. Step 7 remains open externally; do not start step 8.
