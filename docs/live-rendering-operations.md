# Live public rendering operations

Step 5, validated locally against testing on 2026-10-18. No build, deployment,
production writes or legacy import. Pause before step 6.

## Routes and data boundary

`astro.config.mjs` now installs Astro 7.4.0 with Netlify adapter 8.2.10 following
the dependency-maintenance follow-up. `compressHTML: true` preserves the previous
HTML-aware whitespace behavior instead of Astro 7's new JSX default.
`output: 'static'` keeps informational pages static; four route files explicitly
set `prerender = false`: `/`, `/artists/`, `/artists/:id/`, and `/kingdoms/:slug/`.
`about`, `whats-next` and `submit-profile` explicitly prerender. There are no
`getStaticPaths` calls for database artists or kingdoms.

Each request obtains runtime settings through `astro:env/server` in
`src/server/page-environment.ts`, validates the read-only configuration, fetches
published rows through `src/server/artists.ts`, and passes validated ArtistProfile
objects to the extracted page components. It never falls back to JSON or a
privileged Supabase key. Public REST reads request only `id,profile,photo_key`,
filter `status=published`, and remain subject to the existing grants/RLS.
Private email, consent, tokens, jobs and audit records are not queried.

Runtime variables (Netlify Functions scope, correct deployment context):

- `APP_ENV`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `R2_PUBLIC_BASE_URL`
- `BACKEND_TESTING_SUPABASE_REF`, `BACKEND_PRODUCTION_SUPABASE_REF`
- Netlify's `CONTEXT` is checked when present. Non-production contexts must use
  testing; production context must use production. Project pins must differ.

These reads require no database password, Supabase secret key, R2 credentials or
mail key. Other submission/image functions still need their own configuration.
Do not prefix server settings with `PUBLIC_`. Keep preview credentials pointed at
testing. Runtime scoping must be verified on Netlify before deployment acceptance.

## Freshness and failure behavior

All dynamic responses, including errors, set `Cache-Control`,
`CDN-Cache-Control` and `Netlify-CDN-Cache-Control` to `no-store`. Adapter
`cacheOnDemandPages` is disabled. There is no in-process profile cache or shared
HTML cache. Already-open tabs do not update automatically; the next request reads
the latest committed published state. Multi-page directory reads are not a
cross-request/database snapshot: concurrent changes can affect pagination.

Directory reads use ID keyset pagination, request 500 rows, and continue until an
empty result (not merely a short result, because Supabase may impose a lower row
cap). A shared 15-second deadline bounds the read, and repeated IDs fail closed.
Profiles use a targeted single-ID read. Invalid/missing/unpublished artists and
unknown kingdom slugs return 404. Configured kingdoms retain their empty 200
page; additional published kingdoms are discovered per request and disappear
when their final artist is unpublished. Configuration, network/provider or row
validation failures yield a themed 503 with `Retry-After: 60`, never provider
errors, credentials or stale JSON. A malformed published row can make a directory
unavailable: correct the row through audited procedures, then retry.

`src/server/asset-urls.ts` resolves validated published object keys under the
configured public R2 origin without importing SDKs. Images are ordinary image
URLs; `imageCDN: false` disables Netlify image optimization. Temporary previews
are not part of the public read path. No R2 writes occur in rendering.

## Local validation

From `webpage/`, with the existing ignored testing `.env` and CA certificate:

```powershell
npm.cmd test
npm.cmd run astro -- check
node --env-file=.env node_modules/astro/bin/astro.mjs dev --host 127.0.0.1 --port 4327
```

In another terminal, run `npm.cmd run test:rendering`. It pins the testing project,
uses verified TLS for administrative synthetic fixture writes, and exercises
actual HTML using the separate restricted-key read path. It removes its two
randomly named synthetic profiles and their audit fixtures in `finally`. If
cleanup fails, inspect actor `synthetic-step5-rendering` privately in testing;
remove only the probe's records. It sends no mail and creates no images.

For the optional outage server, in a separate terminal:

```powershell
$env:SUPABASE_URL='https://step5-offline.supabase.co'
node --env-file=.env node_modules/astro/bin/astro.mjs dev --host 127.0.0.1 --port 4328 --ignore-lock
```

Then `npm.cmd run test:rendering -- --with-outage`. This creates a deliberate
resource-pin mismatch in that process only; do not change `.env`. Close that
terminal afterward. The script checks 503 HTML for all four public routes.
Automated tests independently simulate provider failures and malformed rows.

Actual results: 46 tests passed; Astro check on 60 files reported zero errors,
warnings or hints. HTTP probe passed publish/unpublish visibility on the next
request, stable URLs/profile metadata, escaped biography, sorted directory,
filter/search attributes, kingdom membership, dynamic kingdom discovery/removal,
404/503 statuses, all no-store headers, no session cookie and secret exclusion.
Legacy form action and informational routes remained present. Both synthetic
fixtures were removed. This does not prove browser filter interactions, deployed
edge headers, static output artifacts or Netlify SSR packaging; those need later
build/deployment acceptance. Initial sandbox type-check dependency reads were
denied; the elevated rerun passed.

## Maintenance and release blockers

Keep the old submission endpoint and JSON files until the planned cutover. Its
GitHub PRs do not update Supabase automatically. Do not deploy these live reads
before the production import and later release gates. Step 6 has now rehearsed
25 profiles in testing; see [migration operations](legacy-migration-operations.md).
About/submission copy describes confirmation and photo storage as
upcoming so the current administrator-review form remains truthful. Browser
wiring of the verified/image adapters and enabling production submission routes
remain later rollout work; this step does not activate those flags.

The original step 5 audit had 16 findings. The follow-up upgraded to Astro 7.4.0 /
adapter 8.2.10, raised the Node minimum to 22.22, and targeted IPX's nested Sharp
with the application's patched version. The final audit has **12 high, zero
critical** findings, all from the unpatched braces/node-forge chains. The counts
include affected parent packages. See [dependency maintenance](dependency-maintenance.md)
for source review, compatibility validation and unresolved release gates. Do not
use a forced audit fix: npm's proposed adapter downgrade requires Astro 5.

No build was run by Codex. The user must run `npm.cmd run build` locally when
ready. Production configuration, Netlify context scoping, edge no-store behavior,
native image packaging, visual/browser acceptance and complete submission-flow
acceptance remain unverified. Step 6 imports and step 7 validation are not done.

References: [Astro Netlify integration](https://docs.astro.build/en/guides/integrations-guide/netlify/),
[on-demand rendering](https://docs.astro.build/en/guides/on-demand-rendering/),
[server environment variables](https://docs.astro.build/en/guides/environment-variables/).
