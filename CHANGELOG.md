# Changelog

## Unreleased

- Fixed: Move legacy GitHub/email helper modules outside Netlify function discovery.
- Added: Post-bundling inspection of final Netlify function ZIPs, with private-data/tooling checks, Linux native dependency checks and per-package hashes.

- Added: Clear resend cooldown, resend-count and hourly request-limit feedback with server-calculated retry timing.

- Fixed: Keep resend/status controls hidden until a submission is accepted, preserve retry identity after errors, and explain rate-limit failures. Rename the status button to Check submission status.

- Added: Administrator publication emails include the saved upgrade-notification opt-in preference; migration 007 snapshots the private preference into notification jobs.

- Changed: Simplify submission and confirmation wording, remove the separate submission-consent checkbox in favor of email confirmation, and restore What's Next to main's version.

- Added: Safe server-only image-service initialization diagnostics that identify configuration stages and invalid variable names without logging credential values.

- Fixed: Ignore stale photo preparation/preview results after changing or removing a photo, and stop submission if the selection changes during its final preview refresh.

- Changed: Use the email-confirmed submission flow at `/submit-profile` on the release branch, retire its GitHub-writing endpoint, and align public privacy guidance with v1.0.1. Missing submission configuration returns 503 instead of hiding the route with 404.

- Added: Testing-only browser submission preview with processed photo uploads, email-confirmation controls, browser rehearsal and fresh build artifact inspection.
- Fixed: Replacement confirmation links opened in the same tab now use the new token while preserving explicit POST confirmation.
- Changed: Historical imports default source record IDs to artist IDs and document optional upgrade-notification preferences without requiring consent fields.
- Added: Repeatable testing migration tools with insert-only receipts, processed legacy photo copies, placeholder reports, private historical-source validation and recovery checks.
- Changed: Upgrade to Astro 7 and Netlify adapter 8, preserve HTML whitespace, and use patched Sharp throughout the image dependency tree.
- Changed: Render public directory, kingdom and artist pages from published Supabase data on each request, preserving URLs and filters with explicit missing/outage responses and no shared HTML caching.
- Added: Submission privacy guidance for the upcoming email-confirmed flow and stored processed photo copies.
- Added: Testing email-confirmed profile publication with scanner-safe links, single-use verification, recoverable image promotion, durable notification retries and orphan cleanup.
- Added: Testing-only private image ingestion with bounded upload/HTTPS processing, immutable WebP previews, scoped capabilities, and expired-image cleanup.
- Added: Supabase database foundation with public/private separation, access policies, profile audits and dashboard correction/restoration procedures.
- Added: Environment-validated server profile adapter and Cloudflare R2 storage boundaries, with local PostgreSQL and testing-provider checks.
- Added: Release and environment setup documentation for v1.0.1.
- Added: Supabase, Cloudflare R2, and bot-protection configuration placeholders.

## 2026-10-13 — v1.0.0

- Added: Initial artist directory with public profiles, search and filters, and profile submissions with administrator email notifications and GitHub review.
