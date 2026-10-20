# Dependency and artifact review — 2026-10-19

Current release-preparation disposition: retain the reviewed tooling dependencies
under the [temporary v1.0.1 exception](dependency-risk-disposition-v1.0.1.md),
review due 2026-11-18. Fresh audit remains 12 high, zero critical. This supersedes
the undecided-risk statements in the historical checkpoint below; it does not
mark the advisories fixed or substitute for the release's hosted package check.

Hosted evidence update: the user supplied a passing final-package report for
commit `2b9aa8fb7b931970dc0f20af633a717ee9da9933`, deployment
`6ad6d79b00418165163b96c8`. All six expected Linux ZIPs have zero scanner
violations, with Sharp 0.35.5 and Linux native files where required. Hashes and
the evidence boundary are recorded in function-packaging-operations.md. This
closes the packaging gate for that snapshot and supersedes pending-packaging
statements below. The separate residual dependency-risk decision remains open.

Follow-up: helper entry points have been relocated and an automatic final-ZIP
inspection hook is implemented. See [function packaging operations](function-packaging-operations.md).
Local tests/discovery pass; the first actual Netlify post-bundling report for the
updated commit is still needed. Historical findings below describe the pre-fix
artifact snapshot and must not be treated as a scan of the new source.

## Result

The user's fresh build passes local artifact inspection. The current npm audit
is not clean: 12 high, zero critical/moderate/low findings, from two underlying
advisories and the dependency chains that inherit their ratings. Installed source
review and local SSR inventory indicate tooling exposure rather than a discovered
public request path. This is not a completed Netlify custom-function ZIP review
or an approved exception to the remaining dependency findings.

No application build, deploy, dependency update, database mutation or mail send
was performed. Existing artifacts were preserved: no Astro dev/check command ran.
Only read-only discovery/inventory and report writing were performed. No force
fix, package stubs or audit suppression was used.

## Fresh local artifact evidence

- `npm.cmd run validate:artifacts`: passed, 387 text files; server artifact fresh.
- About/What's Next are static. Homepage, directory and submission routes are
  not emitted as static HTML. The scanner's broader route checks remain limited
  to its declared assertions rather than a complete deployed routing test.
- No checked private files/values or listed vulnerable/development runtime
  package references found in the generated SSR output.
- Supplementary read-only inventory found 22 named package manifests in the SSR
  directory. None is braces, node-forge, @netlify/dev, @netlify/functions-dev,
  IPX or listhen. Sharp is 0.35.5.
- Supplementary value scan compared plaintext, base64 and URI encodings of long
  credential/private-recipient values from local testing and production settings
  against generated text: no matches. Neither report contains those values.
- Native binaries here are Windows x64 Sharp/libvips, appropriate to this local
  Windows build. This is not evidence of the exact Linux binaries in Netlify's
  packages. The user-reported deployed working photo preview is separate evidence
  that image processing has executed in the testing deployment.

Ignored machine reports: `.netlify/release-validation/artifacts.json` and
`.netlify/dependency-maintenance/runtime-inventory-current.json`.

## Refreshed audit and exposure assessment

`npm.cmd audit --json` queried the registry successfully outside the sandbox;
its exit code is 1 because findings remain. The initial sandbox network attempt
failed and was not treated as a clean result. Current raw audit metadata is in
ignored `.netlify/dependency-maintenance/audit-current.json`.

| Root advisory | Installed chain and assessment | Disposition |
| --- | --- | --- |
| [braces stack exhaustion](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) | braces 3.0.3, through micromatch/fast-glob and Netlify's function-packaging/dev dependencies. Reviewed `zip-it-and-ship-it/dist/utils/matching.js` and `runtimes/node/utils/included_files.js`: patterns come from packaging include/exclude configuration. No app server handler imports these libraries. Not present in local SSR inventory. | Advisory lists no patched version. Keep build patterns trusted; remaining exposure is in tooling. Exact custom-function packages remain uninspected. |
| [node-forge RSA verification](https://github.com/advisories/GHSA-86w9-cpqp-85rv) | node-forge 1.4.0, through listhen/IPX/@netlify/images/@netlify/dev. Reviewed listhen's installed shared module: certificate/key/PFX parsing and signing, with no explicit signature-verification call found there. No application handler imports Forge. Not present in local SSR inventory. | Current npm audit still flags <=1.4.0 and offers no compatible direct patch. Do not infer absence of every transitive call from one source review. Avoid exposing dev servers; finish exact package review before deciding on release risk. |

The registry audit recommends @astrojs/netlify 6.4.1 as a major change. That is
a downgrade from 8.2.10, not a safe patch recommendation for this Astro 7 release.
Do not run `npm audit fix --force` on that basis. Lack of visitor-controlled
inputs in reviewed paths reduces observed exploitability; it does not remove the
installed advisories or automatically authorize a security exception.

`npm.cmd ls astro @astrojs/netlify sharp braces node-forge --all` is clean:
Astro 7.4.0 / adapter 8.2.10, and all Sharp consumers resolve 0.35.5 including IPX.
`npm.cmd install-scripts ls`: no packages with unreviewed install scripts.

Registry outdated check found compatible updates for Astro (7.4.1), AWS S3 and
presigner (3.1153.0), Undici (8.12.3), @astrojs/check (0.9.11), tsx (4.23.15)
and Node 24 types (24.19.2). New majors also exist for @netlify/functions and
TypeScript. None was installed: these are maintenance options, not verified
fixes for the two root advisories. Updating would require fresh validation/build.

## Netlify custom-function packaging assessment

The local Netlify CLI is not available in this execution environment, and no
final custom-function ZIPs exist in the local artifact directories. Therefore
this review cannot claim to inspect the exact deployed packages. A successful
Netlify packaging stage or secret scan does not by itself establish their full
contents. Do not substitute local Windows output for Linux deployment packages.

Used the installed Netlify packager's read-only `listFunctions(..., parseISC:true)`
API; it performs discovery/static configuration analysis, not bundling/building.
It finds the five expected entry points (cleanup-images, profile-image,
publication-jobs, retired submit-profile, verified-profile), plus two helper files:

- `netlify/functions/administrator-notification.mts`
- `netlify/functions/github-submission.mts`

The helper files have no function handler but are discovered as API v1 functions.
This agrees with the earlier user-supplied Netlify build log that packaged both.
They have no purpose as public entry points. Recommendation: move these helpers
outside the functions discovery directory and update imports/tests, preserving
legacy reference code. Then rebuild/redeploy and confirm only intended functions
are packaged. No evidence here shows those helpers exposing credentials, but their
unnecessary discovery is a concrete packaging cleanup item.

Reviewed current application handler/server imports: none directly imports the
flagged development packages. Netlify config uses esbuild and externalizes Sharp.
This source review does not replace inspection of transitive bundled code.

## Remaining decision/gates

1. Remove unnecessary helper entry points, validate, and obtain fresh artifacts.
2. Inspect exact branch-deployment custom-function packages or obtain a complete
   trusted package inventory, including native dependencies and private-file
   exclusion. Identify the deployment commit/version used for that evidence.
3. Fix/remove the flagged tooling dependencies when compatible upstream fixes
   become available, or explicitly review and approve a scoped residual-risk
   decision with the final package evidence. No exception is approved here.

Local artifact inspection is passed for this source snapshot. Dependency risk
and exact custom-function package acceptance remain open, with the narrower
evidence and outstanding work above replacing a generic "audit still needed".
