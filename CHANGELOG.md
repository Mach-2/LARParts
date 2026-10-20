# Changelog

## Unreleased

## 2026-10-19 — v1.0.1

### Added

- Email-confirmed profile publication with bot protection, rate limits, single-use links and recoverable publication/email retries.
- Optional photo upload or direct HTTPS image input, with private previews, validated metadata-free images in Cloudflare R2 and abandoned-image cleanup.
- Repeatable profile/photo migration preserving artist IDs and later edits, plus restricted, audited profile correction and restoration.
- Deployment package checks for private data, unwanted tooling and Linux image dependencies.

### Changed

- Public directory, kingdom and artist pages read published Supabase data on each request, preserving existing URLs and design without rebuilding for profile changes.
- Upgrade to Astro 7, Netlify adapter 8 and patched Sharp, with separate testing/production resources and server-only credentials.

### Removed

- GitHub PR submission workflow, replaced by direct publication after explicit email confirmation.

## 2026-10-13 — v1.0.0

### Added

- Initial artist directory with public profiles, search and filters, and submissions reviewed through GitHub PRs.
