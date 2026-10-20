# Step 4 verification, publication and mail operations

## Resend and hourly feedback — 2026-10-19

Migration 008 was applied to testing and live database policy checks passed.
All 73 local tests pass. Production was not changed and no mail was sent.

Migration 008 preserves existing limits and returns typed resend outcomes after
the capability check. Cooldown returns remaining seconds (up to five minutes),
the three-resend cap returns a non-retryable limit result, and expired/non-pending
submissions return unavailable. None rotates tokens or queues mail. Hourly rate
results include seconds until the next UTC hour. Handler responses distinguish
IP/email hourly caps from resend cooldown with fixed codes and Retry-After for
temporary waits. No submission information is disclosed to an invalid capability.

The client maps known codes to plain-language messages, rounds waits up to whole
minutes, and displays them in the existing status area. Arbitrary server/provider
error text is not copied to the UI. This is timing feedback, not an automatic
retry or countdown; refresh the feedback by trying again after the stated wait.
Apply migration 008 before deploying the new service/client. Earlier migrations
remain unchanged. Old application versions still reject these resend results
with a generic error until redeployed; limits remain enforced throughout.

## Administrator opt-in summary — 2026-10-19

The optional upgrade-email preference is stored as
`private.submissions.upgrade_notifications`, separate from public profiles.
Migration `202610190007_notification_preference.sql` adds a restricted trigger
that copies the saved boolean into administrator notification payloads on insert,
overriding any caller-supplied preference. It also updates existing pending
administrator jobs; sent jobs are not resent or changed. Delivery adds
`LARParts upgrade email notifications opted in: Yes/No` to administrator mail.
Legacy payloads without the field explicitly say it was not recorded in that
notification, never infer No. Confirmation mail remains unchanged.

Apply migration 007 before deploying the new mail formatter. It was applied to
testing with `npm.cmd run test:database -- --migrate`; policy checks passed.
Production is unchanged. Preserve migrations 001–006 and include 007 in the
eventual production migration sequence. Local SQL/service tests cover true and
false persistence, notification snapshots, delivery text and public-data exclusion.
After deployment submit/confirm one profile for each option and inspect the
administrator mail; do not send updates to someone who did not opt in.

This is an opt-in testing backend. It preserves the v1 JSON pages and GitHub PR
submission function; it does not enable the unfinished release in production.
Live public rendering belongs to step 5. Accounts, passwords, claims and profile
editing rights are not created by this flow.

## Configuration and testing

Use `.env.example` as the contract. Existing backend pins, bucket-scoped tokens,
testing Postgres URI and verified-TLS certificate remain required for probes.

- `VERIFICATION_TOKEN_SECRET`: a unique random 32-byte lowercase hex secret for
  this environment. Generate securely; never log it or put it in Git. The local
  testing secret was generated without changing existing credentials. Production
  needs a separate secret. Keep it stable while pending tokens/jobs exist; changing
  it changes the deterministic tokens reconstructed for queued confirmation mail.
- `TEST_EMAIL_ALLOWLIST`: comma-separated controlled testing inboxes. The exact
  name has no underscore between ALLOW and LIST. It restricts **all** new-flow
  confirmation and administrator deliveries. `NOTIFICATION_EMAILS` is not a
  substitute; those administrator recipients must also be allowlisted in testing.
- `EMAIL_PROVIDER_API_KEY`, `FROM_EMAIL`, `NOTIFICATION_EMAILS`: Resend credentials,
  verified sender and restricted administrator recipients. They remain server-only.
- `SITE_URL`: exact approved browser origin, not a URL supplied by a submission.
  Testing permits localhost HTTP; other origins require HTTPS.
- `VERIFIED_SUBMISSIONS_ENABLED=false` and `PUBLICATION_JOBS_ENABLED=false`:
  default-off flags. Endpoints and scheduled publication jobs additionally refuse
  production mode until deployment/cutover gates are accepted in later work.

Run from `webpage/`:

```text
npm.cmd test
npm.cmd run astro -- check
npm.cmd run test:database -- --migrate
npm.cmd run test:publication
```

Use `npm.cmd run test:publication -- --skip-mail` for a storage/database rerun
without further inbox messages. This option belongs only to the trusted test
harness; runtime HTTP handlers have no mail-allowlist or bot bypass.

Do not run builds inside the Codex sandbox. The publication probe targets only
the pinned testing project and buckets. It sends one confirmation and one
administrator notice to allowlisted controlled recipients when successful. It
creates synthetic profiles, private records and photos, injects failures, then
removes those fixtures. Probe email links are intentionally retired during cleanup;
they are not links to keep or use after validation. Provider acceptance does not
prove inbox delivery; record recipient confirmation separately.

## Request contract and scanner-safe confirmation

`POST /api/verified-profile` accepts bounded JSON (32 KiB), an exact same-origin
Origin header and a trusted Netlify client IP. GET on that endpoint returns 405
without database work. Cross-site requests fail before mutation. Provider errors,
private mail addresses, database rows and tokens are never echoed in errors.

- Submit: `{action:"submit",turnstileToken:"...",submission:{requestId,capability,
  profile,submitterEmail,consent:true,upgradeNotifications,companyWebsite:"",image}}`.
  `requestId` is a browser-generated UUID; `capability` is 32 random bytes encoded
  as 43 base64url characters. Reuse the **same** request object for network retries.
  A changed body or capability for the same request ID fails. `profile` uses the
  existing public form validation, excluding raw `photoUrl`. `image` is null or
  `{sessionId,capability}` from step 3; arbitrary asset IDs are not accepted.
- Status/resend: `{action:"status"|"resend",submissionId,...}` with the submission
  capability in `Authorization: Bearer ...`. Resend additionally requires a fresh
  Turnstile token. That capability cannot publish, edit or claim a profile.
- Confirm: `{action:"confirm",submissionId,token}` from the confirmation page.
  The email token is distinct from the submission/image capabilities.

Submit/resend use Turnstile action `profile-submit`, matching the configured site
hostname. Honeypot, all field validation and email normalization run on the server.
Persistent HMAC-address quotas limit submission creation (5 per client IP/hour),
mail creation (3 per normalized address/hour), and management/confirmation requests
(60 per action/IP/hour). Raw IPs are not stored. Missing provider IPs fail closed.
Resend requires pending, unexpired state, a five-minute cooldown, at most three
resends and enough remaining asset retention; old tokens are revoked atomically.

`GET /confirm-profile` returns a page only. The email link carries the submission
ID and token in its URL **fragment**, which is not sent in the HTTP request. The
page captures it in memory, clears it from browser history and does not issue a
mutation until the user submits the Confirm publication form. No automatic
confirmation on load, redirect, HEAD or link preview exists. CSP forbids external
scripts/frames; no-referrer/no-store headers reduce token exposure. The explicit
POST requires same origin and the token. Opening the link alone never publishes.

`src/client/verifiedSubmission.ts` prepares stable retry identities and calls this
API. It and the step 3 browser adapter are ready for later form wiring, while the
legacy public form is intentionally unchanged until the cutover plan permits it.

## Database and image publication sequence

Migration `202610180003_verified_publication.sql` extends private submissions,
tokens, jobs and image sessions, and adds private publication-intent/rate tables.
New private tables have RLS and no public/direct application grants. Only the
server service role can execute `public.publication_operation`; private schemas
remain unexposed. Public clients still read only published public profiles.
Apply corrective migrations `202610180004_publication_mail_aliases.sql` and
`202610180005_publication_cleanup_aliases.sql` in order as well. They repair SQL
aliases that collided with PL/pgSQL record variables, retaining function grants
and the existing applied migration checksums. The runner installs the full chain.

1. Validate request and allowlisted recipient; generate a random token record ID.
   A server-secret HMAC reconstructs an unpredictable confirmation token from
   that nonce; only the SHA-256 hash is stored in the verification record. Neither
   plaintext tokens nor complete confirmation links are persisted in the outbox.
2. In one transaction, serialize the request ID, check idempotency/duplicate public
   identity, lock the processed image session, verify its capability/readiness/
   expiry/bucket and reserve it for **one** submission. Extend its cleanup expiry
   while holding the same row lock. Save private email/consent and queue a
   confirmation job. No public artist exists yet.
3. Deliver the durable confirmation job. The outbox retains the token record ID
   and a frozen private mail context; the worker reconstructs the same link for
   retries. Token lifetime is 24 hours. Resend revokes the previous token and
   creates a new record/job; it is not an editing or ownership operation.
4. Explicit POST checks the token under a submission row lock. Record confirmation
   and publication intent before any R2 promotion. Acquire a five-minute lease.
   Concurrent requests return in-progress; they do not race two publications.
5. Read the processed private copy with the temporary credential and upload it
   with the published credential to create-only `profiles/<submission-id>.webp`.
   Separate bucket scopes preclude assuming one token can do cross-bucket copying.
   Persist a SHA-256 digest first. A retry encountering an existing object verifies
   its digest/length/type rather than overwriting it. Every SDK transfer is bounded.
6. In one Postgres transaction, create the published asset metadata and profile,
   record its audit event, consume the authorized token, mark the submission and
   intent committed, and enqueue exactly one administrator job. Public rows contain
   no private email, consent, capability, verification or job information.
7. Administrator mail links to the published artist URL, with no approval task.
   Mail failures do not undo successful publication. Repeated confirmation returns
   the original outcome and cannot overwrite later administrator corrections.

The public ID for a new record is `artist-` followed by the submission UUID without
hyphens. Existing artist IDs are untouched. Name/kingdom uniqueness is enforced
by the existing normalized database index. Concurrent pending identities may race
to confirm: one wins; the loser becomes failed with an orphan intent rather than
replacing the winner. Accounts/ownership/historical eligibility remain absent.

## Recovering provider and worker failures

There is no R2/Postgres transaction. Once a user explicitly confirms, authorized
intent survives network/process failure. A five-minute scheduled worker recovers
expired leases using that stored authorization; it never creates authorization
from a GET or an arbitrary capability. If R2 succeeded but the database failed,
the next worker verifies/reuses the same object. If the commit succeeded but its
response was lost, a repeated token request returns the committed result without
duplicating the profile or administrator job.

At most ten publication attempts are allowed. Recovery ends at an absolute deadline:
the earlier of five days from submission and six days from the processed asset's
creation, leaving margin before the temporary bucket's seven-day lifecycle rule.
Resends cannot extend past that bound. Failed intents enter a one-day quarantine
before orphan deletion, keeping cleanup away from recently interrupted writes.
Cleanup uses exclusive leases, only deletes the planned object key in the current
published bucket, and excludes assets referenced by profiles. Committed images
are not scanned for orphan deletion. Step 3 handles abandoned private objects.

Resend and recovery jobs are at-least-once execution. The mail worker uses a frozen
message context, exclusive five-minute job leases and a stable Resend idempotency
key per event. It retries with bounded exponential backoff, at most ten attempts.
Resend retains deduplication keys for 24 hours; automatic retry stops after 23 hours
from the first attempt, with margin for a worker request. This prevents silently
resending an ambiguous delivery after the provider forgets its key. Such exhausted
jobs require an operator to check Resend delivery history before any manual resend.
Email itself cannot have transactional exactly-once guarantees across providers.

`publication-jobs.mts` is an opt-in every-five-minute Netlify schedule. Published
deployments execute schedules; deploy previews/local development do not prove
cron execution. Logs contain counts only; safe provider failure categories are
available to the testing probe without printing provider messages or addresses.

Useful restricted-dashboard inspection (never print these private results in CI):

```sql
select id, state, confirmed_at, publication_deadline from private.submissions order by created_at desc;
select submission_id, state, attempts, lease_until, cleanup_after from private.publication_intents;
select id, kind, state, attempts, first_attempt_at, last_error_code from private.notification_jobs;
```

For exhausted publication, inspect the processed source and intended object;
preserve committed records and audited corrections. Do not manually flip pending
profiles to published, consume tokens by GET or delete a possibly committed image.
For failed mail, verify provider acceptance/history and the current testing
allowlist before restarting any delivery. Keep the signing secret stable until
pending records settle or expire; a deliberate rotation needs a new-key/resend
plan. Back up database and assets before production migration/cutover.

## Remaining deployment gates

Actual Netlify environment scoping, production credentials/domains, deployed cron
execution, native function packaging and a real browser Turnstile/confirmation
walkthrough remain external acceptance checks. Inbox receipt must be confirmed
separately from Resend API acceptance. Default-off flags and testing-only guards
remain in place. Public pages still use JSON until step 5 and migration/cutover;
testing profile links may therefore 404 in the old application. Do not enable the
new flow on the production site before those later gates are met.

Sources consulted: [Resend deduplication window](https://resend.com/docs/dashboard/emails/idempotency-keys),
[R2 S3 support](https://developers.cloudflare.com/r2/api/s3/api/), and
[Turnstile server verification](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/).
