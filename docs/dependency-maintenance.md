# Dependency maintenance — 2026-10-18

Current review: [2026-10-19 dependency and artifact assessment](dependency-artifact-review-2026-10-19.md).
Fresh artifact inspection passes; refreshed audit still has 12 high findings.
The report documents runtime inventory, update availability, exposure analysis
and the remaining exact custom-function packaging/risk decision. Older text
below records the October 18 checkpoint.

Follow-up to step 5; step 6 is still paused. No build, deployment, legacy import,
production writes or new mail deliveries were performed.

## Final dependency state

- Astro 7.4.0 with Netlify adapter 8.2.10. The user installed these together after
  an attempted forced audit fix downgraded the adapter to an incompatible major.
- Project Node minimum is now 22.22.0, matching Astro. Validation used the user's
  installed Node 24.22.0 and npm 11.19.1. Netlify must use a supported Node version
  meeting that minimum; its actual runtime/build configuration remains unverified.
- `compressHTML: true` retains Astro 6's HTML-aware whitespace behavior instead
  of Astro 7's JSX default. The project has no custom Markdown processor/plugins,
  `src/fetch.ts`, removed experimental flags or UI framework integrations to
  migrate. Existing Netlify image/page caching options remain supported and off.
- `package.json` scopes an override to `ipx -> sharp: $sharp`. All installed
  consumers now resolve the application's Sharp 0.35.5. IPX 3.1.2 normally asks
  for 0.34.x, so this crosses its declared range and needs explicit regression
  coverage. `tests/dependency-compatibility.test.ts` resolves the actual adapter
  dependency chain and tests JPEG/PNG/WebP resize/conversion using that Sharp.
- npm's existing lock retained stale Sharp 0.34.5 despite install/update/dedupe.
  Only that nested lock entry was invalidated and its installed directory moved
  into ignored `.netlify/dependency-maintenance/`; npm regenerated resolution.
  Rollback copies remain there locally. No broad dependency deletion or forced
  resolution was used. `npm ls sharp astro @astrojs/netlify` is clean and shows
  only Sharp 0.35.5. Commit package.json and lockfile together.
- esbuild 0.28.1's reviewed setup script was approved by exact version in
  `allowScripts`. It prepares/checks its platform binary; no application build
  was invoked. Removing nested old Sharp also removed its pending script warning.
  `npm install-scripts ls` reports no unreviewed scripts. Do not blanket-approve
  future scripts; review each new package/version.

## Remaining audit and exposure review

The final audit reports **12 high, zero critical, zero moderate/low** findings.
These are two underlying unpatched advisories plus parent dependency chains,
not twelve independent application entry points. Audit JSON is retained in
ignored local `.netlify/dependency-maintenance/audit.json` for this review.
`npm audit --omit=dev` alone cannot establish runtime exposure: the adapter is a
production dependency and carries development tools transitively.

| Root finding | Installed path and source review | Remaining action |
| --- | --- | --- |
| braces stack exhaustion | Adapter → Netlify Vite plugin/dev → functions-dev → zip-it-and-ship-it → fast-glob/micromatch → braces. Reviewed bundler `dist/utils/matching.js` and `runtimes/node/utils/included_files.js`: patterns come from packaging include/exclude configuration. No application handler passes visitor patterns to these utilities. | No patched version listed. Keep bundling patterns trusted, do not expose the dev server publicly, monitor upstream, and inspect deployed function contents before accepting release risk. |
| node-forge signature verification | Adapter → Netlify Vite plugin/dev → images → IPX → listhen → node-forge. Reviewed `listhen/dist/shared/listhen.tqe5I1Rl.mjs`: Forge calls handle local development certificates/keys/PFX/signing. No explicit signature-verification call was found in that module. The application does not import Forge for verification/authentication. | No patched version listed. Local servers use loopback HTTP, and image emulation/CDN are disabled. This reduces observed exposure; it does not prove every transitive call or generated deployment artifact safe. Monitor upstream and complete artifact/risk review. |

The Netlify Vite plugin imports NetlifyDev at module scope and supplies a
`configureServer` hook, while build functionality is a separate plugin. Merely
setting `devFeatures: false` does not remove these packages from the installed
tree. Do not replace vulnerable packages with empty stubs, suppress all audits,
or force an older adapter just to reduce the count.

Sources currently list no patched release for
[braces](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) or
[node-forge](https://github.com/advisories/GHSA-86w9-cpqp-85rv).
The [Sharp advisory](https://github.com/advisories/GHSA-f88m-g3jw-g9cj)
and additional installed audit entries were resolved by the patched Sharp tree.
Recheck these sources and `npm audit` at release time; this is a dated assessment.
No residual-risk exception has been approved, and the security gate is not marked
passed. Upstream fixes/removal or an explicit reviewed exception plus verified
artifact boundaries are still required before release.

## Validation performed

- `npm.cmd test`: 47 passed, zero failed, including new IPX/Sharp compatibility
  coverage and existing image safety, SQL policy/publication and legacy tests.
- `npm.cmd run astro -- check`: 61 files, zero errors/warnings/hints.
- `node --env-file=.env --import tsx scripts/test-live-rendering.ts`: actual
  Astro 7.4.0 HTML passed next-request testing publication/unpublishing, dynamic
  kingdoms, metadata, escaped data, filters' attributes, 404s, no-store headers
  and secret exclusion. Both synthetic profiles and audit fixtures were removed.
- Separate actual HTTP checks on four routes passed themed 503s and all three
  no-store headers under the process-only invalid resource-pin configuration.
- `npm install-scripts ls`: no unreviewed scripts. `npm ls` shows a compatible
  framework/adapter pair and the patched deduplicated Sharp.

Astro 7 only permits one tracked dev server per project by default. The optional
second outage server requires `--ignore-lock`; it is not managed by `astro dev
stop`, so close its owning terminal/process explicitly. Both validation servers
were stopped after the checks. Local tests do not establish visual appearance or
Netlify bundle behavior after the compiler/bundler upgrade.

## Next local and deployed checks

The user must run `npm.cmd run build` locally and share the output; AGENTS.md
prohibits Codex from invoking a build. Review any compiler/bundler/native binary
errors before proceeding. Verify generated functions do not include private
environment files or unnecessary development certificate/image tooling. On a
testing Netlify deployment, verify runtime settings, no-store headers, public
routes, static informational pages, existing functions and native Sharp behavior.
No production deployment is authorized by this maintenance follow-up.

For routine maintenance: review `npm outdated` and audit findings regularly,
apply compatible updates with their lockfile, and handle framework/adapter majors
together using the [Astro migration guide](https://docs.astro.build/en/guides/upgrade-to/v7/).
Keep the IPX override only while upstream needs it; remove it once the parent
supports patched Sharp and rerun the compatibility and full suites. Upgrade tools
and lockfile changes are reviewable code changes, not proof of release readiness.
