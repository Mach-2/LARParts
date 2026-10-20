# Release workflow audit — 2026-10-19

This records the current release/v1.0.1 behavior. Earlier step reports describe
historical checkpoints and do not override this audit or the step 7 runbook.
Production main and its persistent staging submission workflow are unchanged.

## Unnecessary preservation corrected

- The new form was isolated at a preview URL. `/submit-profile` now uses the
  email-confirmed form; the preview URL redirects for existing bookmarks.
- The shared form defaulted to legacy review, with conditional copy, URL-only
  input and an alternative submission action. It now has one submission flow:
  optional device upload/direct HTTPS image and explicit email confirmation.
- Browser code still shipped the GitHub submission request and review success
  screen. These were removed; validation now always initializes the new flow.
- The old Netlify function could still create GitHub branches/PRs even though
  public reads use Supabase. Its deployed entry point now returns 410 without
  processing the request. The legacy helper implementation/tests remain as
  rollback reference; they are not called by the deployed entry point.
- About-page privacy copy still promised an upcoming process and current admin
  review. It now describes private processing and direct email confirmation.
- The roadmap incorrectly promised accounts in the next release, username
  login and portfolios in active development. It now places email/password
  accounts in v2 and portfolios beyond that release.
- Missing submission configuration hid the route behind 404. It now returns
  a themed, uncached 503; this is an operational configuration failure.
- README, environment example, artifact expectations and browser rehearsal
  now follow the normal submission route rather than preserving the v1 form.

## Deliberately retained boundaries

- All public directory routes already read Supabase per request with no shared
  caching; no automatic JSON fallback was found. JSON files and repository
  images remain migration inputs and emergency read-only source material.
- Image bytes are in R2, not Postgres or Supabase Storage. Private sessions,
  asset references and publication state remain in Postgres. Both input paths
  share validation, re-encoding, metadata removal and private preview.
- APP_ENV/resource pins, same-origin checks, capabilities, bot protection,
  testing mail allowlists and explicit submission switches protect external
  resources. They are not alternative legacy workflows and remain enforced.
- Production-mode refusal in image/publication handlers and job activation
  remain step 8 rollout gates. Removing them before deployed acceptance would
  start cutover early. This branch currently supports testing operation, not
  an accepted production release. Configuration outages must not bypass gates.
- Cleanup/publication schedules remain separately enabled: testing branch
  deployments do not prove Netlify scheduled execution. Retry/recovery and
  cleanup acceptance must be verified before production activation.
- Legacy import tools remain testing-only until the backed-up final import is
  authorized. Imported profiles must never overwrite subsequent database edits.
- Retained GitHub utilities and baseline tests support provenance/rollback.
  Do not supply GitHub-writing credentials to this branch's deployment.
  Retire production credentials only when the cutover rollback window permits.
- Package version/date/tag, final PR reconciliation, backups, production import,
  deployment and staging repurposing remain cutover tasks. No cutover ran.
- Accounts, claims and owner editing remain v2; informational pages stay static.

## Review and walkthrough

Use testing credentials, both submission flags, Turnstile configuration and
the matching SITE_URL/CORS origin. Open `/submit-profile`, exercise no photo,
upload and direct HTTPS modes, preview the processed copy, and explicitly
confirm the emailed profile. Check its next-request visibility in profiles,
directory/search and kingdom pages. The old endpoint should return 410.
With a required flag disabled, the form route should return 503, never the
legacy form. Restart local development after changing environment settings.

Run `npm.cmd test` and `npm.cmd run astro -- check`. Builds must be run by the
user locally, followed by artifact inspection; earlier build evidence predates
these source changes. Genuine deployed bot/mail, provider and schedule checks
remain external acceptance work, not inferred from local tests.

Validation for this audit: all 59 automated tests pass, including the retired
endpoint regression. The sandboxed Astro check stalled before diagnostics and
was stopped; an unrestricted retry also stalled before diagnostics and was
stopped. Type-check validation remains outstanding. No build or deployment ran.
