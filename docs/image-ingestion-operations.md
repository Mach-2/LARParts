# Step 3 image ingestion and private previews

## Deployed initialization diagnostics (2026-10-19)

`503 {"error":"Image service unavailable"}` is returned by the outer image
endpoint catch, before normal processing; a disabled feature flag has a distinct
`Image ingestion unavailable` response. Initialization errors now log only
`Image service initialization failed` with a stage and fixed code, plus schema
field names for invalid/missing backend fields. No credential values, URLs,
provider error bodies, request data or stacks are logged or added to responses.
After deploying this diagnostic change, retry once and inspect the branch
deployment's `profile-image` function logs. Stages distinguish backend validation,
SITE_URL parsing, missing Turnstile secret and storage-client initialization.
Resource-pin/distinct-bucket/distinct-credential errors have separate fixed codes.
This does not establish which deployed value is wrong without the log evidence.
Regression coverage is in `tests/backend-foundation.test.ts` and exercises
redaction, unchanged generic responses and restoration of test environment state.

This backend is opt-in and testing-only. It does not change the live v1 submission
form, send verification mail, publish photos/profiles, or create accounts. The
reusable browser adapter is `src/client/profileImage.ts`; connect it to the new
submission flow in the later authorized step, not to the legacy GitHub workflow.

## Setup and validation

1. Preserve existing credentials. Apply migrations in **testing only** with
   `npm.cmd run test:database -- --migrate`. The runner now handles sorted migration
   files and verifies every existing checksum; do not edit applied SQL.
2. For the testing temporary bucket, keep public development URL and custom
   domains disabled. Configure the following CORS rules in Cloudflare:

   ```json
   [{
     "AllowedOrigins": ["http://localhost:8888"],
     "AllowedMethods": ["PUT", "GET", "HEAD"],
     "AllowedHeaders": ["content-type"],
     "ExposeHeaders": ["ETag"],
     "MaxAgeSeconds": 300
   }]
   ```

   Replace/add only exact approved testing origins when testing a deployment;
   never use `*`. `SITE_URL` must be that exact browser origin. CORS is a browser
   restriction, not authorization: the signed URL remains a bearer credential.
3. Enable temporary-bucket lifecycle rules for prefix `raw/` (delete after 1 day)
   and prefix `processed/` (delete after 7 days). These are safety backstops, not
   exact deletion timers; provider processing can lag. Never apply these rules to
   the published bucket. Prefixes matter; do not make a whole-bucket rule that
   could accidentally include future long-lived content.
4. Run `npm.cmd test`, `npm.cmd run astro -- check`, and `npm.cmd run test:images`.
   Use the testing database URI and CA from step 2. The image probe bypasses the
   browser/bot entrypoint through trusted server calls, exercises real Supabase/R2,
   and removes its synthetic fixtures. It creates a synthetic public source under
   `image-ingestion-probes/` in the **testing** published bucket for the HTTPS path.
5. The image endpoint defaults off. To exercise it locally, explicitly set
   `IMAGE_INGESTION_ENABLED=true`, use testing configuration, and start the normal
   Netlify development server. Supply a real Turnstile token from a widget whose
   action is `profile-image` and whose hostname matches `SITE_URL`. Never add a
   production bot-check bypass. `src/client/profileImage.ts` provides upload,
   direct URL, no-photo and preview-refresh calls for later form integration.
6. `cleanup-images.mts` declares an hourly Netlify schedule. It defaults off until
   `IMAGE_CLEANUP_ENABLED=true`. Netlify scheduled execution occurs on published
   deployments, not deploy previews or automatically in local development. Before
   enabling it, inspect actual deployment environment scopes so a testing site
   cannot select production resources. The end-to-end probe invokes the same
   cleanup service manually; it does not prove a deployed Netlify cron has run.

No builds are run in the Codex sandbox. Sharp is an external Netlify function
dependency so native binaries are installed for the deployment platform; actual
Linux function packaging/deployment remains a later acceptance check.

## HTTP contract

All API requests are same-origin POST JSON to `/api/profile-image`, at most 8 KiB.
The Netlify context supplies the client IP; arbitrary forwarded headers are not
trusted. A database-backed hourly quota counts all valid operations (60 per client
address HMAC), including failed capability attempts. Raw IPs are not persisted.
Requests without a usable provider IP fail closed. Responses use no-store and
no-referrer headers and never include provider exceptions, capability hashes,
remote URLs, database records or credentials.

- Start: `{action:"start",mode:"upload",bytes:12345,type:"image/png",turnstileToken:"..."}`.
  Returns an opaque session ID/capability and a five-minute presigned PUT URL. The
  signature binds content type and byte length. The browser sends the file with
  that Content-Type and supplies Content-Length automatically. Its actual bytes
  are validated afterward; MIME headers alone are not evidence of image content.
- Remote start: use `mode:"remote"`, with no file fields. Start also requires
  Turnstile. No remote URL is stored in the session record.
- No photo: use `mode:"none"`; returns `{assetId:null}` and creates no image session.
- Process: `{action:"process",sessionId:"...",sourceUrl:"https://..."}` for remote
  input, or omit `sourceUrl` for uploads. Send `Authorization: Bearer <capability>`.
- Preview refresh: `{action:"preview",sessionId:"..."}` with the same Authorization.
  Success returns the session/asset IDs, a 60-second signed private GET URL and
  `expiresIn`. Use `referrerpolicy="no-referrer"` on the preview image. Do not log
  signed URLs/capabilities or save them in localStorage, query strings or analytics.

Sessions last 48 hours. Retry a ready session to get the same immutable asset and
a fresh preview, not a new processing result. A five-minute upload URL cannot be
revoked individually; it can only overwrite its generated raw key while valid.
Lost capabilities cannot be recovered; start a fresh session and let cleanup
remove the abandoned one. Invalid/expired capabilities expose no session data.

## Image validation and remote fetching

`image-processing.ts` accepts at most 5 MiB, checks JPEG/PNG/WebP byte signatures
before invoking any decoder, then checks the decoded format and dimensions.
Animated inputs are rejected. Limits are 10,000 pixels per side and 40 million
pixels total. Sharp rotates using EXIF orientation, resizes inside 1600×1600
without enlarging, and encodes WebP at quality 85. Metadata is not retained.
The decode/re-encode pipeline has a 12-second limit; Sharp cache is disabled and
its worker concurrency is one per instance. Invalid/truncated content fails closed.

`remote-image.ts` requires HTTPS, port 443, no credentials/fragments and at most
2,048 URL characters. It rejects internal/local names and non-public resolved
addresses, including mapped IPv4/IPv6 forms. Every DNS answer must be public.
The actual Undici socket uses the already-validated answers: it never silently
resolves the hostname again. Each of at most three redirects repeats URL/DNS
checks; HTTP downgrades and private destinations fail. There is a 15-second total
fetch budget, five-second connection budget, and bounded streamed response read.
Content-Length is checked early but is not trusted as the only size check.
HTML/SVG/pages are rejected, never searched for image URLs.

## Persistence, retries and cleanup

Migration `202610180002_image_ingestion.sql` adds private image sessions and rate
records, both protected with RLS and no direct application/public table grants.
`public.image_session_operation` is a narrowly scoped security-definer RPC granted
only to `service_role`. It uses an empty search path and fully qualified tables.
The private schema stays unexposed. Browser clients cannot call this RPC with a
publishable key; the server validates capability hashes and origin/bot/quota first.

Capability plaintext is generated from 32 random bytes and returned once. Only
its SHA-256 hash is stored. Each slot belongs to one prospective submission; it
grants no account, profile ownership or later editing right. Step 4 must bind the
session to exactly one submission atomically after validating its hash/readiness/
expiry under a row lock. Never trust an asset ID submitted by a browser alone.
That submission-binding/publication transaction is intentionally not implemented
in step 3, because the new submission workflow is not yet enabled.

Processing claims a ten-minute lease under a row lock, with at most three claims.
Concurrent claims fail; stale workers cannot finish another worker's lease. The
output key is `processed/<session-id>/<lease-id>.webp`, written create-only. A raw
overwrite therefore cannot change an accepted asset. Successful completion inserts
temporary processed asset metadata and marks the session ready in one database
transaction. There is no transaction across R2 and Postgres: if a finish response
is ambiguous, leave the candidate object for retry/cleanup rather than deleting a
possibly committed asset. Retry ready sessions safely; an expired worker lease
gets a different candidate key. Failed validation marks the slot failed.

Hourly cleanup claims up to 20 expired sessions with exclusive leases, skipping
references from public profiles and active/publishing/published submissions. It
deletes raw and processed prefixes (including abandoned lease candidates), then
marks metadata deleted and invalidates the capability. Partial deletion/finalize
failures retry after lease expiry. Missing objects are safe to delete again.
Short-lived rate records are pruned by that job. Stale workers writing after a
cleanup race can leave an orphan; prefix lifecycle expiry is the final backstop.
Published objects are never scanned or deleted by this cleanup service.

Lifecycle rules cannot inspect database references. Step 4 must complete R2
promotion and use a separate published asset reference within the temporary
retention period; it must coordinate reference binding with session cleanup locks.
Do not extend pending publication indefinitely beyond the seven-day backstop.
If a long outage exhausts temporary retention, handle missing input explicitly.

## Acceptance boundaries

Live testing checks prove both inputs yield validated private copies, CORS matches
the approved local origin, wrong origins/capabilities/signatures fail, reused raw
URLs cannot alter a ready preview, and cleanup removes fixture bytes and records.
Lifecycle setup is user-confirmed dashboard configuration; seven days have not
elapsed to independently observe automatic expiry. Production settings, actual
Netlify scoping, deployed cron execution, native Linux packaging and a real browser
Turnstile/form walkthrough remain deployment/step 4 acceptance gates. Keep flags
off in deployed environments until those gates are verified. No gate is inferred
from the presence of configuration files or mocked unit tests.

References consulted:

- [R2 presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/)
- [R2 CORS](https://developers.cloudflare.com/r2/buckets/cors/)
- [R2 lifecycle rules](https://developers.cloudflare.com/r2/buckets/object-lifecycles/)
- [Sharp input limits](https://sharp.pixelplumbing.com/api-constructor/)
- [Sharp metadata defaults](https://sharp.pixelplumbing.com/api-output/)
- [Netlify scheduled functions](https://docs.netlify.com/build/functions/scheduled-functions/)
