# LARParts directory

An Astro site for browsing and submitting Amtgard artist profiles.

## v1.0.1 development

The live JSON/GitHub submission workflow remains active until cutover. Database
profiles, R2 photos, and email-confirmed publication are implemented on
`release/v1.0.1`. See the [workflow audit](docs/release-workflow-audit.md) for
current release behavior and the remaining production rollout gates.

Step 5 now renders public directory pages from Supabase on each request on this
release branch. Informational pages remain static. The deployed v1 site and
legacy GitHub submission workflow remain in place until cutover. See
[live rendering operations](docs/live-rendering-operations.md) for runtime variables,
HTTP validation and remaining deployment gates. JSON profiles are retained for
the migration source and emergency fallback; live routes do not read them.
Step 6 has now rehearsed all 25 public profiles in testing, including the merged
staging additions. See [migration operations](docs/legacy-migration-operations.md)
for import/verification commands, photo follow-ups and private-history handling.

See [the release runbook](docs/release-v1.0.1.md) for environment setup,
baseline provenance, release gates, and rollback requirements. Implement one step
at a time and pause after writing its tutorial in the workspace's `summary_notes/`
directory. This directory and the workspace-root `AGENTS.md` are outside the
`webpage/` Git repository and must be retained separately.

## Requirements

- Node.js 22.22 or newer (dependency maintenance validated with 24.22.0)
- npm

Install project dependencies:

```powershell
npm install
```

## Astro development

To run Astro locally (public pages require the testing environment in `.env`):

```powershell
npm run dev
```

Astro serves the site at `http://localhost:4321`.

## Netlify development

Use Netlify Dev when testing the profile form or serverless functions. It starts
Astro and proxies the site and `netlify/functions` through one local address.

1. Copy `.env.example` to `.env`.
2. Leave unused values blank. Add real local credentials only when the relevant
   integration is implemented.
3. Start the Netlify environment:

```powershell
npx netlify-cli dev
```

Open `http://localhost:8888`. The submission endpoint is available at
`http://localhost:8888/.netlify/functions/submit-profile`.

The endpoint validates and normalizes submissions, rejects malformed or abusive
requests, and opens a pull request containing only the public artist record.
Submission pull requests target the persistent `staging` branch. They never
target the production `main` branch directly. After the pull request exists,
both configured administrators receive a Resend notification containing its
authenticated GitHub review link.

The Netlify CLI may ask you to sign in or link a Netlify project. Local function
execution does not require production secrets, but integrations will require
the variables listed in `.env.example`.

## Production build

```powershell
npm run build
```

Astro writes the static site to `dist`. Netlify uses the same command and
publishes that directory according to `netlify.toml`.

## Environment variables

`.env.example` documents variable names and non-secret repository defaults.
Never commit `.env` files or real credentials.

The intended GitHub authentication method is a repository-installed GitHub App.
If a personal access token is temporarily used for a prototype, use a
fine-grained token restricted to `Mach-2/LARParts` with only the permissions
needed to create a branch, commit the proposed files, and open a pull request.

The GitHub App requires only these repository permissions:

- Contents: read and write
- Pull requests: read and write
- Metadata: read-only

Administrator notifications use Resend. Configure a sending-only API key, a
sender at a verified domain, and one or more comma-separated recipients:

```dotenv
EMAIL_PROVIDER_API_KEY=re_example
NOTIFICATION_EMAILS=admin-one@example.com,admin-two@example.com
FROM_EMAIL=LARParts Directory <notifications@example.com>
```

These values are server-only. Do not prefix them with `PUBLIC_` or commit them.

Install the app only on `Mach-2/LARParts`, then set its App ID, installation ID,
and private key in Netlify's environment-variable settings. For local `.env`
files, the private key may use escaped `\n` line breaks. Never prefix these
variables with `PUBLIC_`, because Astro exposes public-prefixed variables to the
browser.

## Branch workflow

The deployed v1 workflow stores artist records in
`src/data/artists/<artist-id>.json`, with one public profile per file. The filename
must match the record's `id`. Validation rejects duplicate IDs and case-insensitive
name/kingdom combinations. These files remain unchanged on the v1.0.1 release
branch, whose new runtime pages use published Supabase records instead.

Each submission creates only its artist file, based on a pinned staging commit.
The function checks that commit's profiles for duplicates before opening a PR.
The staging branch must contain the migrated artist directory before the updated
function is deployed. Existing PRs that modify `directory.json` need to be
converted separately before approval.

Run `npm test` and `npm run astro -- check` to verify changes, then run
`npm run build` locally to confirm Netlify packaging. Codex must not run builds
in its sandbox. The new public runtime variables are documented in the operations
guide; GitHub App permissions for the legacy submission format are unchanged.

- `main` is the production branch.
- `staging` contains approved profiles waiting for a production release.
- `artist-submission/*` branches contain one proposed public profile and open a
  pull request against `staging`.

After merging `staging` into `main` for a production release—or after unrelated
changes land directly on `main`—merge `main` back into the persistent `staging`
branch. Do not delete, reset, or recreate `staging` after a release.

One Git Bash workflow is:

```bash
git fetch origin
git switch staging
git merge origin/main
git push origin staging
```

If `staging` has not been checked out locally before, use this instead of the
second command:

```bash
git switch --track origin/staging
```

## Release submission flow

The v1.0.1 release branch uses `/submit-profile` for device upload or direct-image
URL input and explicit email-confirmed publication. Both submission flags must
be enabled with testing configuration; unavailable configuration returns 503.
The old preview URL redirects to this form. The GitHub-writing endpoint returns
410 on this branch; production on main retains v1 until cutover.
See [validation operations](docs/release-validation-operations.md)
for local browser rehearsal, Netlify branch configuration and outstanding gates.
