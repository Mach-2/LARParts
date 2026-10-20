# Final Netlify function packaging

## Accepted hosted package evidence — 2026-10-19

The user supplied the successful onPostBuild report for release commit
`2b9aa8fb7b931970dc0f20af633a717ee9da9933`, deployment
`6ad6d79b00418165163b96c8`, platform `linux`. The report has `passed:true`
and zero violations in each of the six expected packages. This closes the
exact custom-function packaging inspection gate for that deployment/source
snapshot; older pending statements below describe the implementation checkpoint.

| Function | Files | Native / Linux | Sharp | ZIP SHA-256 |
| --- | ---: | --- | --- | --- |
| cleanup-images | 408 | 4 / 4 | 0.35.5 | `39b3faf91f92c9f133794aa55a5033019e969a8eec506986b107eaa778effbb1` |
| profile-image | 408 | 4 / 4 | 0.35.5 | `3cd2e8f6ae6c1cb4b0d0d326643be2ff2fc4fb47f437e39a21cf7ffaa82b9b65` |
| publication-jobs | 408 | 4 / 4 | 0.35.5 | `08a61e99816796bcd883b3f33c117bcf1e77bc54a3b1953d01d900946b0874bd` |
| ssr | 393 | 4 / 4 | 0.35.5 | `9aa56edb2c4e8b56f725731538618c635e375eccee8366be1987d7a8a12fbcc9` |
| submit-profile | 199 | 0 / 0 | none | `86b137a71615c3dc8e3a271f57f25a61eba93b9acd63ee85bf343965bfbd83e5` |
| verified-profile | 408 | 4 / 4 | 0.35.5 | `4ec1d1218fcc168e19da6c411b4e6d0bbadab1d9b68bfbe3ab8faf116ebc57ff` |

No unwanted helper entry points, checked private data, listed development/tooling
packages or wrong-platform native files were detected. Absence of Sharp/native
code in the retired submit-profile package is expected. These are user-supplied
CI results, not a second independent download/scan of the archives. The scanner
limitations documented below still apply. This result does not clear installed
npm advisories or independently establish deployed behavior/timer acceptance.

## What changed

Legacy helpers moved from `netlify/functions/` to `src/server/legacy/` with
imports updated in the retained legacy endpoint, tests and GitHub maintenance
script. Read-only Netlify discovery now lists only five application entry points:
cleanup-images, profile-image, publication-jobs, submit-profile and
verified-profile. Astro generates the sixth entry point, ssr. The retired
submit-profile entry still returns 410; moving helpers does not reactivate v1.

`netlify.toml` registers the local plugin at `plugins/function-package-audit`.
Its `onPostBuild` hook reads `constants.FUNCTIONS_DIST` after Netlify bundles
functions and before deployment. This lifecycle is documented by
[Netlify](https://docs.netlify.com/extend/develop-and-share/develop-build-plugins/).
It inspects the actual archives that deployment will use; it does not rebuild,
extract archives, import archived code, call application endpoints or send mail.

## Inspection and failure handling

`scripts/function-package-audit.mjs` checks:

- Exactly six intended function ZIPs, so helper/unknown functions cannot silently
  enter deployment and missing artifacts cannot produce a false pass.
- Private filenames and known credential patterns; plaintext/base64/URI variants
  of configured build-environment private values. Values available only to
  Functions cannot be compared here; server-only lookup and Netlify's secret
  scanning remain additional protections. No scanner proves all possible secrets
  absent, especially unknown/short/transformed values.
- Known unwanted package paths, package manifests and import/bundler markers
  for braces, Forge and the previously reviewed development-tool chain.
  Metadata-only dependency names are not treated as executable imports.
  Minified/renamed code without retained provenance can evade name-based checks;
  this is not a general software-composition or exploitability proof.
- Sharp 0.35.5 when its package metadata is present; the image endpoint must have
  that metadata and at least one native Linux binary. Native .node/.so/.dll files
  must be ELF64 little-endian for the build CPU (x64 or arm64) on Linux.
  These checks identify platform/architecture, not all dynamic linking/N-API
  behavior. Keep deployed image-processing acceptance as a separate gate.
- ZIP safety/inspection bounds, duplicate entries, unsafe symlinks and malformed
  metadata. Archives are read through yauzl without extraction, with 64 MB per
  entry and 512 MB total uncompressed inspection limits per function.

The ZIP reader is a direct pinned dev dependency, yauzl 3.4.0, already present
transitively before this change. Install scripts were disabled; the lockfile
change declares it directly without upgrading the framework/dependency tree.
No new unreviewed install scripts appeared. npm still reports the same 12 high
tooling-chain findings; the package check does not grant a risk exception.

A failed inspection blocks deployment with fixed violation codes. Exceptions
produce a generic failure, not archive entry text or credentials. Successful
inspection logs `Function package audit` with commit/deploy identity, ZIP SHA-256
hashes, counts, Sharp version and results, and adds a deployment summary titled
`Function package audit passed`. No package contents or secret values are logged.
Nothing is written to the public publish directory.

## Validation and rollout

First deployed attempt failed during plugin resolution, before building:
package.json did not declare its non-default `index.mjs` entry point. Added
`main: "./index.mjs"` and verified directory resolution plus dynamic ESM import.
A regression test now covers the same directory lookup; all five focused
packaging tests pass. No archive inspection ran in that failed deployment.

Local evidence: legacy helper tests pass after relocation; synthetic ZIP tests
cover safe packages, private files/encoded values, unwanted tooling, missing and
extra entry points, malformed/traversing archives, wrong-platform native code,
safe failure logging and a successful six-package post-build event. These tests
do not claim an actual hosted package inspection has run.

Full suite: 77 tests passed. Astro check: 85 files, zero errors/warnings and two
existing hints. Final focused archive/import checks also pass. No application
build or deployment was run by Codex.

The user must run builds locally as required by workspace AGENTS.md. Commit all
new helpers/plugin/scanner/tests along with removals, import updates, manifest,
package.json and lockfile, then push the release branch. The next Netlify build
performs the final Linux package inspection automatically. Keep main unchanged.

After that branch deploy, capture the `Function package audit` report and summary
for the exact commit. If it fails, inspect the fixed reason before changing
expected package names or exclusions; do not disable the plugin to get a pass.
In particular, an unexpected native/platform error needs the real package
inventory, not an exception to the check. Share safe log output for review.

Acceptance remains pending until that actual Netlify report is reviewed. This
implementation closes the discovery cleanup and supplies the missing inspection
mechanism; it cannot inspect a future deployment before the user builds/pushes.
After a passing actual report and deployed image/submission checks, use it with
the dependency exposure assessment for the remaining risk decision.
