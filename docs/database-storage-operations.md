# Database and storage foundation operations

This is the v1.0.1 step 2 foundation. It does not switch public pages or the old
submission function to Supabase. No accounts, ownership, claims, verification
endpoints, image processor, importer, or publication worker are introduced here.

## Apply and validate in testing

1. Populate the server variables and six non-secret resource pins in `.env.example`.
   `SUPABASE_URL` is the HTTPS project origin, without `/rest/v1/`.
   `R2_PUBLIC_BASE_URL` is the HTTPS image origin, including `https://`.
2. Copy the testing project's **Connect → Session pooler** URI into ignored `.env`
   as `TEST_DATABASE_URL`. Replace the password placeholder including its brackets;
   URL-encode special password characters. The URI includes user, host, port and
   database. Prefer session pooling on 5432, rather than transaction pooling.
3. Download the testing database root certificate from Database Settings → SSL
   configuration. Store it locally as `.env-testing-ca.crt` and set
   `TEST_DATABASE_CA_FILE=.env-testing-ca.crt`. This filename is Git-ignored by
   `.env*`. Certificate and hostname verification remain enabled.
4. Run `npm.cmd run test:database -- --migrate`. It refuses production configuration
   and URIs not matching the pinned testing project. The SQL migration and ledger
   entry commit together. A lock serializes runners and a checksum detects edits
   to an already-applied migration. Rerunning skips matching applied DDL and reruns
   the rollback-only synthetic SQL tests and the public/private API checks.
5. Run `npm.cmd run test:storage`. This writes unique synthetic `.txt` objects under
   `foundation-probes/` in the two testing buckets, tests each credential's own
   read/write access and opposite-bucket read/write/delete denial, tests unsigned
   temporary S3 access and the published image domain, then deletes and checks
   deletion of both objects. It never tries production credentials/buckets.
6. Inspect the temporary bucket's Cloudflare settings: no custom domains and
   Public Development URL (`r2.dev`) disabled. A private S3 endpoint does not prove
   there are no alternative public delivery routes. Confirm Standard storage and
   token bucket scope in the dashboard. Record those checks separately.
7. Run `npm.cmd test` and `npm.cmd run astro -- check`. Builds are run by the user
   locally, never in the Codex sandbox. No build is needed to exercise this step.

`supabase/migrations/202610180001_foundation.sql` is applied as `postgres`.
Do not put `private` or `larparts_migrations` in Data API exposed schemas. Keep
`public` available, with automatic grants disabled. All new application tables
must have explicit grants and RLS. Defaults here apply to objects created by
`postgres`; other future object-creator roles require equivalent default rules.
The migration globally removes default PUBLIC function execution for that role,
including future schemas. Existing unrelated application objects are not revoked.

Failures print stage and safe error codes, not provider SQL or credential data.
Check DNS, TLS certificate, encoded password and connection mode in that order.
Do not disable TLS verification to make a connection pass. Inspect provider
errors privately in testing if needed. If SQL tests fail, their fixtures roll
back; the separately committed migration remains installed for diagnosis.
If storage cleanup fails, inspect `foundation-probes/` in testing and remove
leftover probe objects. A public-domain cache might briefly retain test content.

## Restricted dashboard administration

Use Supabase SQL Editor with restricted project membership, individual dashboard
identities, and the `postgres` database role. The Table Editor cannot supply audit
context; direct writes without it fail. Application/API roles cannot execute the
administration functions. An operator's actor label is recorded with the database
role; it is a trusted operator assertion, not an independently authenticated app
identity. Supabase dashboard access controls and platform logs provide the
external identity trail. Never share privileged dashboard access with submitters.

Inspect the current record before changing it:

```sql
select id, revision, profile, status, image_asset_id
from public.artist_profiles where id = 'replace-with-real-artist-id';
```

For a correction, pass the complete corrected public JSON document and preserve
the existing image asset ID/status. This example deliberately uses placeholders:

```sql
begin;
select private.admin_change_profile(
  'replace-with-real-artist-id', 1,
  '{"displayName":"Correct public name","awards":[],"skills":[],"contact":{}}',
  'published', null, 'individual operator identifier', 'Ticket/reference and correction reason'
);
-- Inspect profile and audit entry before committing; ROLLBACK if incorrect.
commit;
```

Unpublish without discarding public fields:

```sql
begin;
select private.admin_change_profile(
  id, revision, profile, 'unpublished', image_asset_id,
  'individual operator identifier', 'Recorded unpublish reason'
) from public.artist_profiles where id = 'replace-with-real-artist-id';
commit;
```

Use an explicit previously inspected revision value for a stale-edit guard.
The unpublish example intentionally acts on the current row in one statement.
Verify one returned row: a mistyped ID in the `FROM` example changes nothing.
Query history, then restore an entry's **before** snapshot:

```sql
select id, operation, actor, database_role, reason, before_row, after_row, created_at
from private.profile_audit where artist_id = 'replace-with-real-artist-id' order by id desc;

begin;
select private.admin_restore_profile(
  'replace-with-real-artist-id', 3, 123,
  'individual operator identifier', 'Recorded restoration reason'
);
commit;
```

Replace `3` with the inspected current revision and `123` with the selected audit
ID. A mismatched revision, wrong artist, or absent prior snapshot fails. Restoring
creates another audit event and advances revision; it does not erase history.
An insertion event has no before snapshot. Unpublish instead of deleting artists;
this restoration procedure operates on existing artist rows. Preserve prior image
assets needed by restoration; later cleanup must account for audit references.

For controlled maintenance inserts/imports, use a transaction and set local
`app.audit_actor`/`app.audit_reason` before writing. Public-profile triggers audit
inserts, updates and deletes automatically, enforce immutable artist IDs, advance
revision, and derive photo keys only from processed published metadata. A service
credential cannot alter audit rows. Database owners can still modify database
objects/history: this is operational auditing, not tamper-proof external storage.

## Maintenance and boundaries

Public data lives in `public.artist_profiles`; private metadata stays in `private`.
The latter includes emails, consent versions/timestamps, token hashes, submission
state, asset locations, outbox leases/retries, and profile history. Hash format and
24-hour expiry constraints do not implement token generation or consumption;
those operations and notification retries belong to step 4. Image limits in
metadata do not validate bytes or remove metadata; processing belongs to step 3.

RLS restricts rows after grants permit access. Anonymous and authenticated clients
can only SELECT published profiles and cannot write or access private tables.
Service credentials bypass RLS; their authorization remains server responsibility.
Private schema tables are reached by privileged SQL/future narrowly scoped server
functions, not by automatically exposing the schema as a REST API.

`src/server/config.ts` validates environment context and resource pins. Pins catch
accidental resource swaps; they do not prove a token's actual scope. Production
and preview Netlify scopes still need deployment-level inspection before endpoints
are enabled. `src/server/storage.ts` chooses separate SDK credentials for each
bucket and resolves public URLs centrally. Never connect a domain to temporary
storage or expose SDK clients/credentials to the browser. Supabase RLS has no
authority over R2. R2 and Postgres have no common transaction; later publication
must persist retry state and recover from partial completion.

Add new migrations rather than editing applied SQL. Back up data/assets before
production changes; restore plans must preserve post-cutover records. There is
no production migration command in this testing runner. Keep JSON and the existing
GitHub PR submission function operational until the later authorized cutover.

Provider references consulted for implementation:

- [Supabase grants and RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Supabase API keys](https://supabase.com/docs/guides/getting-started/api-keys)
- [Supabase verified PostgreSQL TLS](https://supabase.com/docs/guides/database/psql)
- [Cloudflare R2 SDK configuration](https://developers.cloudflare.com/r2/examples/aws/aws-sdk-js-v3/)
- [Cloudflare R2 scoped credentials](https://developers.cloudflare.com/r2/api/tokens/)
