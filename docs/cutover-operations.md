# Step 8: production rollout preparation

## Production directory diagnostics

If a new production deployment still returns the themed directory 503 after
correcting variables and rebuilding, deploy the diagnostic hotfix and refresh
that deployment's permalink. Inspect the `ssr` function logs for
`Public directory unavailable`. These logs contain only a stage, fixed code,
configuration field names and optional HTTP status. Never log or paste raw
provider responses, request headers, environment values, SQL data or stacks.

| Code | Next check |
| --- | --- |
| `invalid_public_read_fields` | The listed variables are absent or malformed at runtime; check Production context and Functions scope, then rebuild. |
| `public_read_environment_mismatch` | Check APP_ENV, Netlify CONTEXT and the distinct testing/production project pins. |
| `public_read_resource_mismatch` | Check SUPABASE_URL matches the selected project pin and the production image domain is not r2.dev. |
| `database_http_error` | HTTP 401/403: check the production restricted key and API permissions. HTTP 404: check project URL/schema availability. HTTP 5xx: check provider health. Status alone does not establish the exact cause. |
| `database_network_or_timeout` | Investigate runtime connectivity/provider availability. |
| `database_invalid_json` / `published_data_invalid` | Investigate API response shape or published-row validation through restricted operator tools. |

Both BACKEND_*_SUPABASE_REF values retain their named environment's reference in
every deployment context. They must differ from each other. A deployment permalink
does not change the deployment's context; production permalinks use production
configuration. These changes retain generic public 503 responses and no-store
headers. No credentials, URLs or public/private record contents enter diagnostics.

Diagnostic implementation validation: 82 tests pass, including cases for missing
runtime keys, malformed URL paths, pin mismatch, HTTP 401/403/404/503, thrown
network errors, invalid JSON/rows and absence of private values in logs. Astro
check passes on 92 files with zero errors/warnings and two existing hints.
Prepared on hotfix/public-directory-diagnostics from local main. No build,
commit, push, merge or deployment ran for this diagnostic change.

2026-10-19. In progress; production data is copied, and the live deployment is
unchanged. The user requested a
small rollout focused on production variables and carrying intended testing data
into production. Leave legacy submissions open; check for new submission PRs just
before deployment. Earlier mandatory-freeze instructions are superseded by this
decision. No broad repeat of the completed testing rehearsal is required.

## Release preparation — 2026-10-19

Package.json and both root package-lock version entries are aligned to 1.0.1.
CHANGELOG.md retains Unreleased plus a dated 1.0.1 entry with seven substantial
changes, grouped into Added/Changed/Removed; wording and repeated incremental
fixes are condensed. This is prepared release metadata, not evidence of a live
deployment; adjust its release date if actual publication happens later.

Fresh checks pass: 81 automated tests; direct Astro check with telemetry disabled
completed on 92 files with zero errors/warnings and two existing hints. The prior
stall did not reproduce, and no code defect/root cause was established. Fresh
registry audit remains 12 high, zero critical. The scoped temporary tooling-risk
decision is recorded in [dependency disposition](dependency-risk-disposition-v1.0.1.md),
with review due 2026-11-18 and a required passing hosted audit for the release.
No dependency versions changed. No build, commit, push, merge, tag or deployment
was performed in this preparation. Existing untracked docs were preserved.

## Prepared code

The submission page, image/publication endpoints and publication recovery job now
accept validated production configuration. Existing explicit enable flags,
environment/context checks, independent project/bucket pins, same-origin checks,
Turnstile and testing recipient allowlists remain enforced. Production image
processing now rejects HTTP localhost SITE_URL; localhost is testing-only.

Import and verification commands support production via a separately named
PRODUCTION_DATABASE_URL, optional PRODUCTION_DATABASE_CA_FILE and
PRODUCTION_IMPORT_CONFIRM equal to BACKEND_PRODUCTION_SUPABASE_REF. TLS remains
verified. URI query overrides and mismatched project hosts/pooler users are
rejected. Synthetic provider probes retain the testing-only default. Historical
personal data remains prohibited in testing apply operations.

## Current findings

### Production data transfer completed — 2026-10-19 (Vancouver)

Supersedes the missing-SQL-URI/schema findings below. The user supplied the URI
and production certificate in ignored local files. SQL connected with verified
TLS and the supplied CA. A read-only plan confirmed zero application tables,
zero migration entries and an empty production published bucket before writes.
An ignored empty-baseline receipt was retained; there were no application records
or referenced images to back up at that point. This is not a general-purpose
database backup, and future populated-production changes still require backups.

Applied all eight ordered migration files with original checksums and the existing
ledger format. Imported 25 public profiles using their approved IDs/source fields.
Copied the 14 already-processed testing images byte-for-byte into production R2
Standard with generated production asset IDs/keys and durable import receipts.
Retained four placeholders and seven no-photo profiles. Testing was read-only;
no remote legacy image downloads, image recompression, deployment or email ran.

All 25 restricted-key public profiles match their approved source fields. All
14 stored/public production image digests equal the verified testing bytes.
Final SQL inspection: eight matching migration checksums, 25 completed imports,
25 published profiles, 14 processed published assets; zero submissions, tokens,
notification jobs, image sessions or historical records. Public RLS is enabled;
anonymous profile insertion/private submission reads are denied; the restricted
private-schema Data API request is denied. No personal history was transferred.

Tools: `scripts/production-transfer-config.ts` reads local operator files without
modifying them; `scripts/transfer-production-data.ts` defaults to no mode and
requires `--plan` or `--apply --confirm-project PROJECT_REF` (both modes require
the confirm-project argument). `--plan` reads provider data and writes only local
safe receipts. Applied migrations are checksum-checked; mismatches and unmanaged
existing schemas stop the transfer. Existing profile edits are not overwritten.
Image writes are immutable and recoverable through private import receipts.
`scripts/verify-production-transfer.ts` repeats the final read-only count,
checksum and access checks. Credentials/private records are withheld from logs.
The tools are for this 25-profile/14-photo rollout and deliberately enforce those
reviewed counts; use a newly reviewed source plan for later migrations.

Safe ignored evidence: `.netlify/release-validation/production-empty-baseline.json`,
`production-transfer.json` and `production-transfer-verification.json`.
81 tests pass; Astro check before the final verification helper passed on 91
files with zero errors/warnings and two existing hints. No build ran.
The final check rerun after adding the verification helper stalled before
diagnostics both in the sandbox and unrestricted, and was stopped. Do not label
that rerun a pass; the helper itself executed successfully against production.

Step 8 remains open for release review/deployment, dependency disposition,
production runtime/mail/timer acceptance, version/tag and branch synchronization.
The data copy does not prove actual Netlify context-variable values. Deploy
previews must still use testing credentials and APP_ENV=testing.

### Live comparison — 2026-10-19

The user confirmed `.env-prod` is a personal reference file, not deployed runtime
configuration. Its earlier validation failure is not a Netlify failure or a
reason to require every application variable in that local file. The user reports
checking production Netlify variables. Deploy previews were reported configured
with production values; they must instead use testing resources and APP_ENV.
Leaving preview SITE_URL blank disables submissions but does not isolate resources.

Fresh live testing verification passed all 25 source profiles and 14 copied
photos, including Violet's audited correction, four accepted placeholders and
seven profiles without photos. Direct comparison found no public-field changes
or extra/missing testing profiles. Stored photo reads passed; the established
verifier also checked object/public digests, dimensions and absent metadata.

Read-only production inventory used candidate credentials from the reference file,
constructing the Supabase URL from the independently recorded production pin and
normalizing the image origin in memory. No file/configuration was changed. The
restricted production API returns HTTP 404 / PGRST205 for artist_profiles; this
means the table is unavailable through its API/schema cache, not proof of an empty
database. The production published R2 bucket lists zero objects. SQL inspection
is needed before applying migrations. No production write or email occurred.

`scripts/compare-production-data.ts` reproduces that read-only comparison and
saves a safe ignored report under `.netlify/release-validation/`. It does not
validate Netlify settings and never prints credentials or private records.

The SQL connection URI is not available locally. Requested the user securely save
PRODUCTION_DATABASE_URL (and an optional CA file setting) outside Git; do not
paste the password into chat. Next: inspect schema/ledger and preserve existing
state, apply migrations, then copy the intended 25 profiles and 14 photos. Prefer
the verified existing processed photo bytes rather than depending on remote
legacy image URLs still being available. Private histories/sessions/tokens/jobs
are outside this public profile/photo transfer.

- Source HEAD: 2b9aa8fb7b931970dc0f20af633a717ee9da9933 before these edits.
  Existing untracked docs were preserved. No commit, push, deploy or tag ran.
- Local tests: 81 passed. Astro check: 86 files, zero errors/warnings, two existing
  hints. No build ran. The later read-only config helper was added afterward.
- `.env-prod` fails local schema validation: SUPABASE_URL, R2_PUBLIC_BASE_URL and
  all six BACKEND_* pins require checking/populating; VERIFICATION_TOKEN_SECRET
  is missing. Credentials and private recipients were never printed.
- Netlify's actual production context is unverified; local files do not prove it.
- GitHub remote read failed in the sandbox. External-read approval was declined;
  current branch commits/open PRs and actual deployed baseline remain unverified.
- Last cleanup evidence retained 25 testing profiles, 14 copied photos, four
  placeholders and seven no-photo profiles. These are recorded prior results,
  not newly queried counts. Source includes the approved Violet photo correction.
- Dependency exception still needs an explicit disposition before release.

## Small rollout sequence

1. Validate production server configuration and resource isolation. Run from
   webpage/: `node --env-file=.env-prod --import tsx scripts/check-production-config.ts`.
   This reads local configuration only; no mail, writes or network calls. Keep
   production secrets exclusively in ignored files and Netlify Production scope.
   Both BACKEND_* sets identify their named environments everywhere. Confirm the
   actual production SMTP/sender, Turnstile hostname, temporary-bucket privacy,
   CORS/lifecycle and published image domain. Never substitute testing credentials.
2. Read production inventory and compare testing public profiles with the approved
   source. Use the existing insert-only importer if equivalent. If testing contains
   later intended edits absent from JSON, preserve those explicitly before import;
   do not overwrite them or blindly clone the testing database. Runtime sessions,
   test tokens/jobs and testing R2 bucket references must not enter production.
   Preserve factual private history only from the securely supplied source.
3. Before writes, retain a restorable production database snapshot and referenced
   R2 assets. Apply ordered migrations 001–008 without changing their SQL/checksums.
   The current test:database runner is deliberately testing-only: a separately
   reviewed production migration runner/procedure is still needed. Do not point
   TEST_DATABASE_URL at production to bypass this restriction.
4. With schema ready, run the import dry-run using the production env file directly
   (npm import scripts load testing .env):
   `node --env-file=.env-prod --import tsx scripts/import-legacy.ts --check-images`.
   Review the report before adding `--apply`. Verify with
   `node --env-file=.env-prod --import tsx scripts/verify-legacy-import.ts`.
   The production confirmation pin is required even for these database reads.
   Reports are ignored under .netlify/migration-reports; archive important runs
   privately because a later run overwrites the same report filename.
5. Check new legacy PRs, finalize approved source, align package/lock versions and
   dated changelog, review the release and deploy to main. Ask the user to build
   locally if needed; never run a build in the sandbox. Keep the packaging plugin.
6. Check production pages/images and one controlled real submission: private
   preview, email arrival, GET without publication, explicit confirmation POST,
   next-request visibility and administrator notice. Observe scheduled recovery
   and cleanup separately; a branch deployment does not prove timers execute.
   Clean only identified synthetic fixtures. Tag the accepted deployed commit,
   then synchronize persistent staging through a merge without resetting it.

## Failures and maintenance

Stop on pin/schema/import conflicts; use the reported configuration field names
without logging values. Imports retain receipts and never overwrite later edits;
rerun the same source to recover interrupted R2/SQL work. Do not delete receipts
or bulk-delete image prefixes to resolve an error. Review pending mail/publication
work and image-cleanup failure counts without logging private records.

Rollback must preserve every newly published Supabase record and R2 object.
Disable submission flags to pause new writes if necessary, and repair/redeploy a
compatible backend. An old JSON snapshot is an emergency read-only fallback;
do not resume its GitHub-writing flow over the new source of truth. Retire legacy
GitHub-writing credentials after the rollback need ends, rather than at preparation.
