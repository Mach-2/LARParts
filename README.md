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
requests, and prepares a public artist record without private submission
metadata. It does not write to GitHub or send administrator notifications yet;
those integrations are added in later phases.

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
