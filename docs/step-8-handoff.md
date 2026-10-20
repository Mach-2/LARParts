# Step 8 handoff — 2026-10-19

The user considers the current checks wrapped up and intends to start step 8 in
a new session. No step 8 production work was started. Read workspace AGENTS.md,
the release runbook and the referenced evidence before preparing the cutover.

## Current implementation and evidence

- Work on release/v1.0.1. Main remains the deployed v1 production baseline;
  persistent staging still supports that workflow until actual cutover.
- Supabase public request-time reads, private R2 upload/HTTPS processing,
  explicit POST email confirmation, durable publication/mail recovery and
  testing migrations 001–008 are implemented. Accounts/claims remain v2-only.
- The release's normal `/submit-profile` uses the new flow; the preview URL
  redirects. The old submission endpoint on this branch returns 410. Do not
  accidentally restore the old release UI based on historical step notes.
- User reported deployed photo preview, submission and confirmation working.
  They verified testing resource pins, set the stable SITE_URL, updated R2 CORS
  and Turnstile, and resolved notification allowlist configuration. Hourly-limit
  and five-minute resend-cooldown failures were diagnosed; explicit feedback is
  now implemented. Do not imply every possible manual variant was witnessed.
- Wording/style requests are implemented; What's Next was restored to main;
  unsolicited About privacy section and submission checkbox removed. The
  confirmation button/email now say Confirm submission. Existing API consent
  compatibility flag remains; do not represent it as a checkbox attestation.
- Optional upgrade preference persists privately and appears in administrator
  emails via migration 007. Migration 008 adds authoritative resend/rate timing.
- Last full local suite: 77 passed; Astro check: 85 files, zero errors/warnings,
  two existing hints. The subsequent plugin entry-point fix added a directory
  resolution test; all five focused packaging tests passed afterward. Do not
  relabel this as a newly rerun full suite of 78.
- Final hosted ZIP audit passed for commit
  `2b9aa8fb7b931970dc0f20af633a717ee9da9933`, deployment
  `6ad6d79b00418165163b96c8`, Linux. Exactly six intended functions, zero reported
  violations. Package hashes/counts are recorded in function-packaging-operations.md.
  This closes the packaging check for that snapshot; keep the post-build plugin.
- Removed all four user-named Test Profile submissions: three published public
  profiles, one pending submission and linked jobs/tokens/sessions/assets.
  Scoped R2 absence checks passed; the remaining 25 profiles were unchanged and
  the restricted public API had no Test Profile entries. See cleanup report.

## Dependency disposition

Latest audit: 12 high findings rooted in braces/node-forge tooling chains;
no critical findings. No patched versions listed when reviewed. The hosted
package scan detected none of the flagged tooling; installed source review
found no public application input path into the affected functionality.

Recommendation given to the user: accept a scoped temporary tooling-risk
exception for v1.0.1, retain package checks, keep dev servers private and build
configuration trusted, review within 30 days or on relevant dependency changes.
The user then said checks are wrapped up; there was no separate explicit
statement accepting that exception. Preserve that distinction. Record an
explicit disposition before the final production release approval, rather than
silently marking the advisories fixed or approved. Do not force an adapter
downgrade or suppress audits to obtain a clean count.

## Step 8 must address

1. Inspect branch/status, outstanding PRs, actual production baseline and latest
   source. Keep all uncommitted/untracked docs and existing profile fixes. Do not
   commit ignored private configuration, test receipts or historical records.
2. Prepare/test production-capable paths: submission page, image endpoint,
   publication endpoint/job and import context currently have testing-only
   guards. Flags alone cannot launch production. Preserve resource pins,
   same-origin checks, private/public boundaries and environment mail separation.
3. Verify production configuration and operator identities, SMTP/sender/domains,
   Turnstile, private temporary-bucket CORS/lifecycle and separate credentials.
   Do not copy testing resources/allowlists into production. Both BACKEND_* sets
   are non-secret pins; each identifies its named environment in all contexts.
4. Prepare the final migration/import, backup/restore and rollback procedures.
   Migrations stay checksummed/ordered; don't edit applied SQL. Production import
   tooling must be explicitly pinned and validated before final execution.
5. Reconcile outstanding profile PRs, plan a brief legacy-submission freeze,
   back up production data/assets, import final approved profiles with stable IDs
   and factual securely supplied private history. Preserve later database edits.
   Four unavailable-photo placeholders were accepted migration outcomes with a
   follow-up report; don't scrape webpages or invent missing private data.
6. Stage backward-compatible migrations before dependent code; release through
   review. Verify production next-request reads, image processing, genuine mail,
   explicit confirmation, error behavior, recovery and controlled test cleanup.
7. Activate/observe recovery and image-cleanup timers appropriately. Branch
   deployments do not prove timer execution; maintenance logic was tested but
   production timer acceptance is separate. Monitoring must avoid private logs.
8. Align package/lock to 1.0.1, date CHANGELOG and tag the actual accepted commit.
   Preserve the previously accepted baseline tag. Retire GitHub-writing
   credentials when rollback permits; repurpose staging without deleting/resetting.
9. Write ../summary_notes/08-cutover-and-operations.md with actual results,
   maintenance, failures, rollback, manual walkthrough and remaining setup.

Rollback must preserve new Supabase records and R2 assets. JSON is an emergency
read-only fallback, never a replacement source of truth after cutover.

## Evidence to read

- release-v1.0.1.md and release-validation-operations.md
- function-packaging-operations.md
- dependency-artifact-review-2026-10-19.md
- testing-cleanup-2026-10-19.md
- verification-publication-operations.md and legacy-migration-operations.md
- ../summary_notes/07-validation.md (outside the application Git repository)

Earlier handoff sections and step reports are historical checkpoints. This
handoff supersedes statements that the new release form is hidden at a preview
URL or that final function-package inspection is still missing. It does not
authorize performing step 8 in the session that created this handoff.
