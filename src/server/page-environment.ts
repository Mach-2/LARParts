import {getSecret} from 'astro:env/server';
import {PUBLIC_READ_ENV_NAMES} from './config';

// Adapter runtime lookup; no privileged keys and no wholesale import.meta.env
// object captured at build time. Astro also supplies local .env values in dev.
export function publicPageEnvironment():NodeJS.ProcessEnv{
  return Object.fromEntries(PUBLIC_READ_ENV_NAMES.map(name=>[name,getSecret(name)]));
}
