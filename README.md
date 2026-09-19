# LARParts directory

An Astro static site for browsing and submitting Amtgard artist profiles.

## Requirements

- Node.js 22.12 or newer
- npm

Install project dependencies:

```powershell
npm install
```

## Astro development

To run the static Astro site without Netlify Functions:

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
