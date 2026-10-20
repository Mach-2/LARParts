# Testing results and synthetic cleanup — 2026-10-19

## Confirmed scope and result

The user authorized removing their submissions named exactly `Test Profile`:
three published and one not published. Read-only inventory matched exactly three
published public profiles and four new-flow private submissions. The fourth was
pending, not an unpublished public-profile row.

Cleanup used the testing configuration and verified-TLS database context, with
independent testing project/bucket pins. The four inspected submission IDs were
fixed as the target set; no name-only bulk deletion or production access ran.

Removed:

| Item | Count |
| --- | ---: |
| Published synthetic public profiles | 3 |
| Private synthetic submissions, including the pending submission | 4 |
| Notification jobs | 8 |
| Verification records | 5 |
| Linked image sessions | 3 |
| Linked image asset metadata records | 6 |

Associated publication intents and synthetic profile audit fixtures were also
removed. A final independent query found zero targeted notification jobs,
verification records, intents, image sessions or profile audit fixtures.

Seven target R2 keys were verified absent with HEAD; this includes the expected
published-image key for the no-image pending submission, so it is not a claim
that seven previously existing images were deleted. The raw/processed prefixes
of all three linked sessions were also listed and verified empty. No broad
bucket sweep or unrelated abandoned-session deletion was performed.

All 25 other public profile rows matched their pre-cleanup digest exactly.
The restricted testing public Data API returned 25 profiles and no Test Profile
entries. Production and imported profile/image records were not modified. No
emails were sent, rate limits reset, build started or deployment triggered.

## Failure handling and receipts

A private-value-free local receipt was written before mutation at
`.netlify/release-validation/test-profile-cleanup-receipt.json` (ignored by Git).
It contains stages, scoped IDs/object keys, counts and a protected-profile digest,
not emails, capabilities, verification tokens or full submission records.
The scoped one-off script is beside it and is also ignored.

The database deletion ran in one transaction with submission locks, active-mail
lease checks, target-name/source checks, image-sharing checks and audited profile
deletion. Linked rows were removed in foreign-key order. The receipt persisted
the R2 deletion plan before deleting metadata, making object deletion recoverable
if the process stopped between providers. Completion requires absence checks and
the unchanged-profile digest; both passed.

These are explicitly synthetic testing records, so their private audit fixtures
were removed too. Do not use this fixture-removal procedure for genuine public
profiles: ordinary operator actions use the audited unpublish/restore procedures.
This receipt is a cleanup record, not a backup capable of restoring deleted tests.

## Current validation checkpoint

- Latest automated suite: 73 tests pass; Astro check on 82 files has zero errors
  or warnings and two existing hints.
- User-run fresh build followed by local artifact inspection: passed on 387 text
  files, with the SSR inventory/private-value checks recorded in the dependency
  and artifact report. No new application source changed during this cleanup.
- User reports deployed photo preview, submission and confirmation working.
  Published synthetic records provide independent evidence of three completed
  publication flows. Do not infer which image modes, resend or inbox variants
  passed solely from those rows; document any further user acceptance separately.
- The reported no-photo failure was traced to the existing hourly rate limit.
  No-photo HTTP behavior and cooldown/limit feedback have automated coverage;
  this cleanup does not independently establish a deployed no-photo confirmation.

Cleanup is complete. It does not close the remaining dependency-risk decision
or exact Netlify custom-function package review. See
[the dependency/artifact assessment](dependency-artifact-review-2026-10-19.md),
including the two helper modules discovered as unnecessary standalone functions.
No step 8 production cutover was initiated.
