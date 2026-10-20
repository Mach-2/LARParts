# Legacy migration operations

Step 6 testing rehearsal, 2026-10-18. Pause before step 7. Tools explicitly reject
production; no production import, build, deployment or mail delivery occurred.

## Source and result

The user requested including approved but unreleased staging profiles. Fetched
`origin/staging` at `1318445` and merged it into `release/v1.0.1` with merge commit
`cc99f7e`. Only two new artist JSON files were added. The release branch's existing
image fix and all uncommitted implementation work were preserved. No push or
reset/deletion of staging was performed. Outstanding submission PRs still need
reconciliation at cutover; this merge is not a permanent submission freeze.

The first rehearsal imported 23 public profiles before the staging request. The
merged dry-run found those 23 unchanged and two new records. The incremental apply
inserted only those two. Final source: 25 files in `src/data/artists/`.

| Verified item | Result |
| --- | --- |
| Source profiles / matching public records | 25 / 25 |
| Stable artist HTTP URLs | All 25 returned 200 with no-store headers |
| Public fields / individual restricted-key reads | All matched source |
| Processed copied photos | Initially 13; now 14 after the authorized Violet correction below |
| Unavailable-photo placeholders | Initially 5; now 4 |
| Profiles that had no source photo | 7 |
| Complete rerun | 25 unchanged; no profile updates or image recopy |
| Private historical source | Not supplied; only synthetic private-history records tested |

The 25 public profiles and 13 copied photos are intentionally retained in testing
for the user's walkthrough. Synthetic probe profiles, history, audit fixtures and
object were removed. Existing public JSON files were not rewritten by the importer.

### Photo follow-up report

| Artist ID | Outcome |
| --- | --- |
| `artist-3135685e4844d32e` | Source unavailable; placeholder |
| `artist-9c30dfcd888a397e` | Source unavailable; placeholder |
| `artist-bb78363845d3a8b9` | Source unavailable; placeholder |
| `artist-de2d3774572ddf60` | Download was not an accepted decodable image; placeholder |

On 2026-10-18 the user explicitly confirmed that `artist-6b95f0ac94c38a47` should
use `Violet.jpg`. Corrected its JSON path to `/photos/Violet.jpg`, processed and
copied the image into testing R2, and assigned it using a revision-checked audited
profile correction. Other public fields/status were preserved. Restricted-key
reads and public image SHA-256 delivery matched the new copy; three source-directory
tests passed. The original import receipt/checksum remains intact. Consequently
the insert-only importer reports this profile as `source_changed`, and the strict
baseline verifier intentionally flags it for manual comparison rather than
rewriting history or overwriting its correction. Current testing totals are 25
profiles, 14 copied photos, four placeholders and seven without photos. Production
was untouched. The corrected source will be used in the future production import.

Remote social/CDN links may expire or return HTML. Obtain a valid direct image
or an approved local file before cutover if a photo is desired. Never scrape a
webpage for an image. These placeholders are accepted migration outcomes with
follow-up, not successful photo copies. A completed receipt is not automatically
replaced by a later source-file correction; use audited correction tooling for
an already-imported database profile.

## Files and commands

- `supabase/migrations/202610180006_legacy_import.sql`: private durable profile
  receipts, historical records and SQL-operator-only prepare/commit/abandon functions.
- `src/server/legacy-import.ts`: strict source loading, hashes, safe local/remote
  image processing, insert-only import orchestration and private-history preflight.
- `src/server/legacy-import-store.ts`: SQL and published-bucket operations.
- `scripts/legacy-import-context.ts`: testing DB/bucket pins and verified TLS.
- `scripts/import-legacy.ts`: default dry-run, explicit apply/private-history/abandon.
- `scripts/test-legacy-import.ts`: synthetic live recovery/private-history probe.
- `scripts/verify-legacy-import.ts`: source/DB/public API/R2/optional HTTP comparisons.

From `webpage/`, using the existing ignored testing `.env` and CA certificate:

```powershell
# Installs only unapplied checksummed migrations, then runs SQL policy tests.
npm.cmd run test:database -- --migrate

# Read-only plan; no source image downloads unless requested.
npm.cmd run import:legacy
npm.cmd run import:legacy -- --check-images

# Testing write rehearsal; never production.
npm.cmd run import:legacy -- --apply --source-label release-v1.0.1
npm.cmd run test:migration
npm.cmd run verify:migration
```

The public import writes its latest safe report to ignored
`.netlify/migration-reports/dry-run.json` or `apply.json`. Each row contains public
artist ID, source checksum, outcome and bounded diagnostic codes. Reports contain
no source image URLs, private emails or provider error details. They overwrite
the previous same-mode report; copy a report securely if its earlier state matters.

To verify real HTML, start a loopback dev server in another terminal:

```powershell
node --env-file=.env node_modules/astro/bin/astro.mjs dev --host 127.0.0.1 --port 4329 --ignore-lock
npm.cmd run verify:migration -- --http-origin http://127.0.0.1:4329
```

Run the second command from a separate terminal while the server remains running.
The verifier checks every artist, directory links, relevant kingdoms and homepage,
alongside source fields, restricted API reads, R2/public delivery and metadata.
It deliberately fails if an imported profile was subsequently edited: compare
that record manually rather than resetting it to make the check pass. Other
unrelated testing profiles are allowed and reported in the published total.

## Idempotency and cross-provider recovery

The loader checks filenames/IDs and duplicate identities using the existing public
schema. Checksums sort JSON keys but preserve array order. Public DB JSON excludes
ID/photo URL; the stable ID and processed image reference have separate columns.
Original JSON is retained for cutover provenance/emergency read-only fallback.

Prepare persists a private receipt and, for a copied photo, a pending asset with a
generated `legacy-imports/<uuid>.webp` key and expected content digest/dimensions.
The object is written immutably with conditional PUT and read back for digest/size
verification before SQL publication. Restart can recover a previously written
object without re-downloading its original source. If a missing object needs to
be recreated, the processed source must still match its saved digest; otherwise
the receipt remains retryable for manual investigation.

Commit locks the receipt, validates its digest, marks the asset processed, inserts
the published profile and records the completed receipt/revision in one SQL
transaction. It creates no verification tokens, notification jobs or ownership.
Unique ID or normalized identity conflicts are recorded for review. Failed insert
attempts roll back trigger audit effects, preventing phantom profile revisions.
R2 and SQL do not share a transaction: durable receipts make partial work visible
and recoverable instead of claiming transactional publication across providers.

Reruns never update an existing artist. Completed receipts return unchanged or
preserved-edit/deleted status; even deleting an imported profile does not let a
rerun resurrect it. Changed JSON checksums are reported as source changes. An
existing DB profile without a receipt is preserved. SQL row/advisory locks protect
receipts, and the CLI's testing advisory lock serializes import/abandon runners;
public reads and dashboard corrections continue independently.

The synthetic provider rehearsal exercised a lost response after an actual R2
write, source-unavailable resume, public object delivery, later audited correction/
unpublishing, duplicate-identity conflict, abandonment and private-history retries.
An earlier probe exposed JSONB double encoding in the SQL client adapter. It was
fixed with the client's explicit JSON encoder before the public import; migration
SQL was not edited after application.

## Maintenance and orphan cleanup

Inspect receipts with state `prepared`, `conflict` or `abandoned` and incomplete
`object_deleted_at`. Normal recovery is rerunning the same source import. Do not
rewrite a checksum to force a different source through an existing receipt.
For deliberately discarded prepared/conflicted work:

```powershell
npm.cmd run import:legacy -- --apply --abandon ARTIST_ID
```

This permanently marks the receipt abandoned before deleting its R2 object. It
refuses completed imports and assets referenced by current or historical profile
audit data, validates the pinned bucket/generated key, and retries safely after
an interrupted deletion. A 404 delete is harmless. Published-bucket import objects
have no temporary lifecycle backstop, so inspect pending/conflicted receipts after
an interrupted rehearsal. The existing submission cleanup job does not own these
objects. Do not bulk-delete `legacy-imports/` or remove completed receipts.

## Private historical records

No historical file was supplied. It is not necessary to publish public profiles.
If original submission emails/consent exist and should be retained, preserve those
facts separately before cutover; missing records cannot be reconstructed from a
public JSON profile. They are not verified new submissions, owners or future
claim eligibility. No invented consent date/version, opt-in or verification state
is assigned. Missing consent/notification fields remain SQL NULL.

Suggested user-managed location, outside the repo and its OneDrive project:
`C:\Users\madis\LARParts-private\historical-submissions.json`.
Create it manually with restricted access; do not paste contents into chat,
commit it, or use production personal records in preview/testing imports. The
tools reject paths whose real location is inside the Git root. No such file or
directory was created by this step.

Format (synthetic illustration only):

```json
[
  {
    "artistId": "nl-0002",
    "email": "synthetic+artist@example.invalid",
    "upgradeNotifications": true
  }
]
```

For this one-record-per-artist file, supply the existing exact artist ID;
`sourceRecordId` is optional and defaults to `artistId`. Explicit source IDs from
older files remain supported and should not be removed if already imported with
a different ID. Consent fields can be omitted; optional old consent fields remain
accepted for compatibility and missing values stay NULL. Set `upgradeNotifications`
to the JSON boolean `true` for explicit opt-in, `false` for explicit opt-out,
or omit/use `null` if unknown. Do not use quoted strings such as `"true"`.
Email is trimmed/lowercased without
removing dots or plus suffixes. Unknown fields are rejected. Preflight blocks
missing artists, duplicate record IDs and one email ambiguously mapped to multiple
artists. Reports print counts only, not private record IDs, addresses or values.

```powershell
npm.cmd run import:legacy -- --history C:\Users\madis\LARParts-private\historical-submissions.json
```

That defaults to dry-run. The testing `--apply` path permits only synthetic
`@example.invalid` addresses. Private imports use a separate RLS-protected table
with no application/API role grants and one transaction, skipping existing record
IDs without overwriting later data. An actual production private import requires
the later reviewed production/cutover workflow; do not simply remove the testing
guard or point TEST_DATABASE_URL at production. Public profile migration can
proceed without a historical file; factual-history retention needs an explicit
source/availability decision, not guessed data.

## Validation and remaining gates

Final post-merge validation: 53 automated tests passed; Astro check on 68 files
reported zero errors, warnings or hints. The testing migration/checksum runner
also passed all SQL policy/import checks against the populated 25-profile database.
Local PostgreSQL tests enforce actual grants, edit preservation, identity-conflict
audit rollback, digest checks and abandonment. Provider and complete real HTTP
comparisons passed as detailed above. Applied migrations 001–006 retain their
checksums. Synthetic private records were cleaned; no real historical data entered
testing. No migration reads or writes production.

This is a rehearsal, not cutover. Reconcile any subsequently merged profiles and
outstanding PRs at the later freeze; back up production before final imports.
New browser photo-upload/verification form wiring, full browser acceptance,
dependency-risk disposition and deployed packaging/environment validation remain
release gates. The user reported the current live-render view mostly looked good;
no new build was run by Codex, and no unprovided build log is claimed verified.
Step 7 and step 8 have not started.

References: [PostgreSQL INSERT/conflicts](https://www.postgresql.org/docs/current/sql-insert.html),
[R2 S3 compatibility](https://developers.cloudflare.com/r2/api/s3/api/).

### Verifying an approved correction

`npm.cmd run verify:migration -- --allow-audited-corrections` verifies the current
public profiles against source while permitting explicitly audited corrections.
For a corrected photo it checks the current matching audit, approved source bytes,
processed digest/dimensions and public delivery. It never rewrites original import
receipts or accepts arbitrary source drift. This verifies Violet's approved
Violet.jpg assignment; the default verifier retains strict baseline behavior.
