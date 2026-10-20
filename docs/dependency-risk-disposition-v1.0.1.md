# v1.0.1 dependency disposition — 2026-10-19

## Decision

Retain the current dependency lockfile for v1.0.1 under a scoped temporary
tooling-risk exception. Defer remediation of the two underlying advisories until
a compatible fix is available and validated. This disposition is recorded by
Codex during the user's explicitly requested release preparation; it does not
claim that the user separately approved an exception in an earlier session.
Production publication remains a separate reviewed action.

Review by **2026-11-18**, or immediately on a relevant dependency/configuration
change, a newly available fix, evidence of visitor-controlled input reaching the
affected functionality, or a failed hosted package audit. Repository maintainers
own that follow-up. This exception is limited to the reviewed v1.0.1 tooling
chains; it does not cover future findings, public runtime exposure or other releases.

## Current findings and rationale

The refreshed registry audit on 2026-10-19 reports **12 high, zero critical**
findings. These are two root advisories plus affected dependency chains, not
twelve distinct root vulnerabilities. The audit exits 1 because findings remain;
the successful registry response is retained in ignored
`.netlify/dependency-maintenance/audit-release-prep.json`. The initial sandbox
network failure was not counted as a successful audit.

| Root advisory | Reviewed exposure | Disposition |
| --- | --- | --- |
| [braces stack exhaustion, GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) | Installed 3.0.3 through packaging/dev dependencies; reviewed packaging patterns originate in trusted build configuration. No public application input path was found in the recorded source review. | Temporarily retain; upstream advisory lists no patched version as of this review. |
| [node-forge RSA signature verification, GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv) | Installed 1.4.0 through Netlify development/image tooling; recorded source review did not find the vulnerable verification path exposed through application handlers. | Temporarily retain; upstream advisory lists no patched version as of this review. |

The underlying source/exposure analysis is in
[the dependency review](dependency-artifact-review-2026-10-19.md). The accepted
hosted report for commit `2b9aa8fb7b931970dc0f20af633a717ee9da9933`, deployment
`6ad6d79b00418165163b96c8`, found no flagged tooling in the six intended Linux
function packages; see [packaging evidence](function-packaging-operations.md).
These scans and source reviews reduce observed exposure, but cannot prove the
absence of all bundled/transformed vulnerable code or every possible call path.

The refreshed audit suggests adapter 6.4.1 as a major change. That would downgrade
the current 8.2.10 adapter and is not a validated fix for this Astro 7 application.
No dependency downgrade, forced audit fix, audit suppression or package stub is
included in this preparation. Package/lock changes only align the release version.

## Conditions retained for release

- Keep the final-function-package audit plugin enabled. The release deployment
  must produce its own passing package report for its actual commit; the older
  accepted report is evidence for that snapshot only.
- Keep development servers private and build/include/exclude configuration
  trusted. Do not expose these tooling paths through application endpoints.
- Continue reporting audit findings honestly. Apply a compatible remediation in
  a separately tested update, with fresh hosted package inspection.
- Complete production configuration/runtime verification before publishing the
  release. This exception does not establish those separate deployment gates.

## Release preparation checks

Prepared package/lock version: 1.0.1. Local source started at `5b2d5fa` with the
release edits still uncommitted. `npm.cmd test`: **81 passed**.
`ASTRO_TELEMETRY_DISABLED=1 node node_modules/astro/bin/astro.mjs check` completed:
**92 files, zero errors/warnings, two existing hints**. The previous stall did
not reproduce; no code defect or root cause was established and no workaround
that skips checking was introduced. No application build or deploy was run.
