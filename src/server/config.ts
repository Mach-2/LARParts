// This directory must only be imported by server handlers or maintenance scripts.
import { z } from 'zod';
if (typeof window !== 'undefined') throw new Error('Server module imported in browser');

const httpsOrigin = z.url().refine(value => {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && !u.username && !u.password && u.pathname === '/' && !u.search && !u.hash;
  } catch { return false; }
});
const bucket = z.string().regex(/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/);
const schema = z.object({
  APP_ENV: z.enum(['testing', 'production']),
  CONTEXT: z.string().optional(),
  SUPABASE_URL: httpsOrigin.refine(v => {
    try { return /^[a-z0-9]+\.supabase\.co$/.test(new URL(v).hostname); } catch { return false; }
  }),
  SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  SUPABASE_SECRET_KEY: z.string().min(1),
  R2_ACCOUNT_ID: z.string().regex(/^[a-f0-9]{32}$/),
  R2_TEMPORARY_BUCKET: bucket,
  R2_TEMPORARY_ACCESS_KEY_ID: z.string().min(1),
  R2_TEMPORARY_SECRET_ACCESS_KEY: z.string().min(1),
  R2_PUBLISHED_BUCKET: bucket,
  R2_PUBLISHED_ACCESS_KEY_ID: z.string().min(1),
  R2_PUBLISHED_SECRET_ACCESS_KEY: z.string().min(1),
  R2_PUBLIC_BASE_URL: httpsOrigin,
  // Independent deployment pins. APP_ENV alone cannot detect swapped credentials.
  BACKEND_TESTING_SUPABASE_REF: z.string().regex(/^[a-z0-9]+$/),
  BACKEND_PRODUCTION_SUPABASE_REF: z.string().regex(/^[a-z0-9]+$/),
  BACKEND_TESTING_TEMPORARY_BUCKET: bucket,
  BACKEND_TESTING_PUBLISHED_BUCKET: bucket,
  BACKEND_PRODUCTION_TEMPORARY_BUCKET: bucket,
  BACKEND_PRODUCTION_PUBLISHED_BUCKET: bucket,
});
export type BackendConfig = z.infer<typeof schema>;

// Only codes and schema field names may be logged, never raw parser errors.
export class BackendConfigurationError extends Error {
  constructor(message:string,public readonly code:string,public readonly fields:string[]=[]){super(message);}
}

const readSchema=schema.pick({APP_ENV:true,CONTEXT:true,SUPABASE_URL:true,SUPABASE_PUBLISHABLE_KEY:true,R2_PUBLIC_BASE_URL:true,BACKEND_TESTING_SUPABASE_REF:true,BACKEND_PRODUCTION_SUPABASE_REF:true});
export type PublicReadConfig=z.infer<typeof readSchema>;
export const PUBLIC_READ_ENV_NAMES=['APP_ENV','CONTEXT','SUPABASE_URL','SUPABASE_PUBLISHABLE_KEY','R2_PUBLIC_BASE_URL','BACKEND_TESTING_SUPABASE_REF','BACKEND_PRODUCTION_SUPABASE_REF'] as const;
export function loadPublicReadConfig(env:NodeJS.ProcessEnv=process.env):PublicReadConfig{
  const parsed=readSchema.safeParse(env);
  if(!parsed.success)throw new BackendConfigurationError('Invalid public directory configuration','invalid_public_read_fields',
    [...new Set(parsed.error.issues.map(issue=>String(issue.path[0])))]);
  const c=parsed.data;
  if(c.BACKEND_TESTING_SUPABASE_REF===c.BACKEND_PRODUCTION_SUPABASE_REF ||
    (c.CONTEXT && c.CONTEXT!=='production' && c.APP_ENV!=='testing') ||
    (c.CONTEXT==='production' && c.APP_ENV!=='production'))throw new BackendConfigurationError('Public directory environment mismatch','public_read_environment_mismatch',['APP_ENV','CONTEXT','BACKEND_TESTING_SUPABASE_REF','BACKEND_PRODUCTION_SUPABASE_REF']);
  const ref=c.APP_ENV==='testing'?c.BACKEND_TESTING_SUPABASE_REF:c.BACKEND_PRODUCTION_SUPABASE_REF;
  if(new URL(c.SUPABASE_URL).hostname!==`${ref}.supabase.co` ||
    (c.APP_ENV==='production' && /(^|\.)r2\.dev$/.test(new URL(c.R2_PUBLIC_BASE_URL).hostname)))throw new BackendConfigurationError('Public directory resource mismatch','public_read_resource_mismatch',['SUPABASE_URL','R2_PUBLIC_BASE_URL','BACKEND_TESTING_SUPABASE_REF','BACKEND_PRODUCTION_SUPABASE_REF']);
  return c;
}

export function loadBackendConfig(env: NodeJS.ProcessEnv = process.env): BackendConfig {
  const parsed = schema.safeParse(env);
  // Do not expose values through Zod errors or logs.
  if (!parsed.success) {
    const fields=[...new Set(parsed.error.issues.map(i=>String(i.path[0])))];
    throw new BackendConfigurationError(`Invalid backend configuration: ${fields.join(', ')}`,'invalid_backend_fields',fields);
  }
  const c = parsed.data;
  if ((c.CONTEXT && c.CONTEXT !== 'production' && c.APP_ENV !== 'testing') ||
      (c.CONTEXT === 'production' && c.APP_ENV !== 'production')) throw new BackendConfigurationError('Deployment environment mismatch','deployment_environment_mismatch');
  if (c.BACKEND_TESTING_SUPABASE_REF === c.BACKEND_PRODUCTION_SUPABASE_REF) throw new BackendConfigurationError('Supabase projects must differ','supabase_projects_not_distinct');
  const buckets = [c.BACKEND_TESTING_TEMPORARY_BUCKET,c.BACKEND_TESTING_PUBLISHED_BUCKET,c.BACKEND_PRODUCTION_TEMPORARY_BUCKET,c.BACKEND_PRODUCTION_PUBLISHED_BUCKET];
  if (new Set(buckets).size !== 4) throw new BackendConfigurationError('All environment buckets must differ','buckets_not_distinct');
  const prefix = c.APP_ENV === 'testing' ? 'BACKEND_TESTING' : 'BACKEND_PRODUCTION';
  if (new URL(c.SUPABASE_URL).hostname !== `${c[`${prefix}_SUPABASE_REF`]}.supabase.co` ||
      c.R2_TEMPORARY_BUCKET !== c[`${prefix}_TEMPORARY_BUCKET`] || c.R2_PUBLISHED_BUCKET !== c[`${prefix}_PUBLISHED_BUCKET`]) throw new BackendConfigurationError('Backend resource pin mismatch','backend_resource_pin_mismatch');
  if (c.R2_TEMPORARY_ACCESS_KEY_ID === c.R2_PUBLISHED_ACCESS_KEY_ID || c.R2_TEMPORARY_SECRET_ACCESS_KEY === c.R2_PUBLISHED_SECRET_ACCESS_KEY) throw new BackendConfigurationError('R2 credentials must be separately scoped','r2_credentials_not_distinct');
  if (c.APP_ENV === 'production' && /(^|\.)r2\.dev$/.test(new URL(c.R2_PUBLIC_BASE_URL).hostname)) throw new BackendConfigurationError('Production images require a custom domain','production_image_domain_required');
  return c;
}
