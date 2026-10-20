# Steps 1–7 readiness review — 2026-10-19

Latest cleanup checkpoint: [testing results and cleanup](testing-cleanup-2026-10-19.md).
The four user-named synthetic Test Profile submissions and linked assets are
removed and verified; all 25 other profiles are unchanged. Current audit/artifact
results are in [the dependency/artifact review](dependency-artifact-review-2026-10-19.md).
Those updates supersede the corresponding historical open checks below, while
dependency-risk and exact custom-function packaging acceptance remain open.

Decision: remain in step 7. The release implementation exists, but current
validation and deployed acceptance do not yet justify starting cutover.

Latest artifact checkpoint — 2026-10-19: after the user reported a fresh local
build following the photo-race fix, `npm.cmd run validate:artifacts` passed.
The scanner checked 387 text files, confirmed fresh SSR output and the expected
static/runtime separation (including runtime `/submit-profile`), found no saved
private values/files, and found no listed vulnerable/development package
references in SSR output. This supersedes the stale-build gate below for this
source snapshot. It does not inspect Netlify-packaged handwritten functions,
approve dependency risk or establish deployed acceptance. No Astro command or
build was run during this artifact check.
This is a source/evidence review, not a new production or provider rehearsal.
No production settings, data, credentials, imports or deployments were changed.

## Evidence boundaries

Reviewed the seven tutorials, release/handoff/operations documents, current
route/form wiring, configuration guards, image processing and storage modules,
publication handler/service, migrations and policy tests, migration tooling,
browser harness, artifact scanner, dependency records and working-tree status.
Fresh `npm.cmd test`: 59 passed, zero failures. These include real local
PostgreSQL through PGlite; they do not independently query current hosted state.
Historical testing-provider results below are recorded evidence from October 18,
not probes rerun during this review. Latest source changes have no fresh accepted
browser/build/deployed-artifact result. Fresh Astro check completed on 80 files:
zero errors/warnings, two non-blocking hints (unused legacy request parameter and
unnecessary await in its test). Invocation: `node node_modules/astro/bin/astro.mjs check`.

## Step-by-step assessment

| Step | Implemented and evidenced | Remaining acceptance |
| --- | --- | --- |
| 1. Release foundation | Existing release branch/profile fixes retained; changelog, environment inventory, runbook and tutorials exist. The recorded baseline was accepted by the user. | Much implementation is still modified/untracked locally: it must be reviewed, committed and included in the testing deploy. Branch protection was explicitly deferred, not an outstanding gate. Do not recreate the accepted baseline tag. |
| 2. Database/storage | Six versioned migrations; private/public separation, RLS/grants, restricted public reads, resource pins, scoped R2 clients and audited dashboard operations. Recorded testing DB/R2 permission probes passed. | Actual Netlify context scoping and production provider/security configuration are not independently accepted. Confirm restricted operator access and operational ownership. Preserve applied migration checksums. |
| 3. Image ingestion | Device upload and direct HTTPS share content validation, 5 MB limit, decoded-dimension limits, metadata-free bounded WebP output and private R2 preview. Remote fetching rejects private destinations and revalidates redirects with pinned DNS. Recorded testing restrictions/CORS probes passed. | The asynchronous form race below is fixed; repeat current browser paths and verify deployed CORS/native Sharp. Cleanup logic is tested, but scheduled execution/lifecycle expiry are not established by local probes. |
| 4. Verification/publication | Explicit POST confirmation, 24-hour single-use hashed tokens, same-origin/bot/rate checks, idempotency, private pending records, recoverable R2 promotion, durable mail/recovery jobs. SQL/service tests cover expiry, concurrency, lost responses and recovery. | Genuine deployed Turnstile and complete inbox flow remain unaccepted. Production guards intentionally remain; production activation must be implemented and tested as part of cutover preparation. Timer behavior is separate from service tests. |
| 5. Live rendering | Homepage/directory/kingdom/profile routes read published Supabase data on each request without shared response caching. Informational pages stay static. Missing/outage states, metadata and public-data adapters are tested. | Verify current packaged deployment headers, isolation, stable URLs, filters, responsive appearance and next-request visibility. The submission page is now runtime too; the earlier static-form build result is obsolete. |
| 6. Migration | Stable IDs, insert-only receipts, rerun/edit preservation, processed legacy images, unavailable-photo report and private-history dry-run tooling exist. Recorded testing totals: 25 profiles, 14 copied photos, four placeholders, seven no-photo profiles. | Reverify the accepted source snapshot after later profile changes. Confirm the four documented placeholders are accepted; replacement photos are optional. Private history has a recorded 24-record dry run, not a completed production import; missing factual records must remain missing. |
| 7. Validation | Current 59-test suite passes. Earlier provider probes and Edge harness cover upload/HTTPS/no photo, retries, confirmation and publication. Legacy endpoint now returns 410; the normal release form uses email confirmation. | Current type check, browser rerun, fresh user-run build/artifact inspection, deployed acceptance and dependency disposition remain open. |

## Source-review finding: stale photo preparation (fixed 2026-10-19)

Resolved after this review: the form increments a selection revision on every
photo change. Preparation/refresh results and errors are ignored if obsolete;
submission aborts if the selection changes during its final preview refresh.
No-photo mode explicitly clears the image reference. Seven deferred-promise
regressions in `tests/photo-selection.test.ts` exercise the actual form handlers
with synthetic controls/services, including successful unchanged submission.
Real deployed browser acceptance remains outstanding; this finding no longer
blocks step 7 on implementation grounds. Original finding follows for context.

Fix validation: 66 automated tests pass; Astro check covers 81 files with zero
errors/warnings and the two existing unrelated hints. No build or deployment ran.

Priority: fix before step 7 acceptance. In
`src/client/verifiedSubmissionForm.ts`, `setBusy()` disables buttons but not the
mode/file/URL inputs. `photoChanged()` clears `image` even while a preparation is
in flight. The pending handler later assigns its result without checking whether
the selection changed. Thus a user can start photo A, select photo B or no photo,
and receive A's stale preview. Submit passes any non-null image reference even
when mode has become none. This can publish a photo the user removed.

This is established by source control flow, not a browser reproduction in this
review. Resolve by preventing edits while processing or ignoring results from
obsolete selections. Add regression coverage with deferred preparation: switch
to no photo or another file/URL before completion; the obsolete result must not
restore the removed asset or become the submitted image. Also check failure and
preview-refresh paths. This is not covered by the current happy-path harness.

## Required before beginning step 8

1. Photo race fix and regression coverage are implemented. Complete validation and
   rerun the native browser harness for the changed normal route, preview redirect,
   three photo modes, mode switching, consent, retry/resend and confirmation.
   The current-source type check passed during this review; repeat after fixes.
2. Have the user run a fresh build locally, then inspect artifacts before another
   Astro command clears adapter output. Include current runtime `/submit-profile`,
   retired endpoint and private-value checks. The October 18 build is historical.
3. Refresh dependency audit/exposure review. The last recorded audit was 12 high,
   zero critical findings in braces/node-forge chains; this is not a current audit.
   Resolve findings or obtain a concrete reviewed risk decision supported by
   packaged exposure. A clean SSR scan alone does not inspect custom functions.
4. Review/commit the implementation and deploy the exact release commit to a
   testing Netlify branch with testing credentials, correct SITE_URL, allowed
   Turnstile hostname, private-bucket CORS and controlled mail allowlists. Inspect
   the actual scoped environment rather than assuming local .env is deployed.
5. Accept the deployed Linux functions and site: upload/HTTPS processing, private
   preview access, genuine bot checks, confirmation and administrator inbox mail,
   scanner-safe GET/explicit POST, resend/expiry/retry, next-request visibility,
   public/private separation, URLs, headers, errors and environment isolation.
   Remove synthetic fixtures; retain imported profiles.
6. Refresh migration verification and agree the cutover inputs and operational
   plan: accepted placeholders/private-history source, production resource pins,
   operator access, backups/restore approach, rollback preservation, final PR
   reconciliation, brief freeze and recovery/cleanup timer verification plan.
   Record external checks as open until actually verified.

## Work belonging to step 8, not evidence of step 7 completion

- Back up production DB/assets and perform the final reconciliation/freeze/import.
- Add explicitly authorized production support to the form route, image handler,
  publication handler/job and production migration tooling. These currently reject
  production, so setting flags alone cannot launch v1.0.1. Test this code before
  the production switch; preserve resource pins, origin checks and mail separation.
- Verify production secrets/domains, apply backward-compatible migrations before
  dependent code, release through review, and activate/observe scheduled jobs.
- Set package/lock version to 1.0.1, date the changelog and tag the accepted commit.
- Execute the rollback/monitoring plan while preserving new Supabase/R2 records;
  retire GitHub-writing credentials when rollback permits; repurpose persistent
  staging without deleting/resetting it; write the step 8 operations tutorial.

These tasks need a concrete plan before entering step 8, but performing the actual
production freeze/import/deploy is step 8 itself. No accounts or v2 claims are
required. Older step notes are historical checkpoints; use this review and the
workflow audit to avoid treating stale preservation wording as current behavior.
