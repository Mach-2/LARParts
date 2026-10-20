import { readFile,readdir } from 'node:fs/promises';
import postgres from 'postgres';
import { loadBackendConfig } from '../src/server/config';
import { readPublishedArtists } from '../src/server/artists';

// node --env-file=.env --import tsx scripts/test-database.ts [--migrate]
const config = loadBackendConfig();
if (config.APP_ENV !== 'testing') throw new Error('Database validation requires testing');
const connection = process.env.TEST_DATABASE_URL;
if (!connection) throw new Error('TEST_DATABASE_URL required; API keys cannot run migrations');
let url: URL;
try { url = new URL(connection); } catch { throw new Error('Invalid TEST_DATABASE_URL; value suppressed'); }
const ref = config.BACKEND_TESTING_SUPABASE_REF;
if (!((url.hostname === `db.${ref}.supabase.co`) ||
  (url.hostname.endsWith('.pooler.supabase.com') && decodeURIComponent(url.username) === `postgres.${ref}`))) throw new Error('Testing database target does not match project pin');
const caFile = process.env.TEST_DATABASE_CA_FILE;
const ca = caFile ? await readFile(caFile,'utf8') : undefined;
const sql = postgres(connection, { ssl: ca ? { ca, rejectUnauthorized: true } : 'verify-full', max: 1, connect_timeout: 10, onnotice: () => {} });
let stage = 'connect';
try {
  if (process.argv.includes('--migrate')) {
    // Serialize runners and track checksums rather than silently rerunning DDL.
    const { createHash } = await import('node:crypto');
    await sql`select pg_advisory_lock(101001002)`;
    stage = 'migration ledger';
    await sql`create schema if not exists larparts_migrations`;
    await sql`revoke all on schema larparts_migrations from public, anon, authenticated, service_role`;
    await sql`create table if not exists larparts_migrations.applied (name text primary key, checksum text not null, applied_at timestamptz not null default now())`;
    const directory=new URL('../supabase/migrations/',import.meta.url);
    for(const file of (await readdir(directory)).filter(name=>/^\d+_[a-z0-9_]+\.sql$/.test(name)).sort()) {
    const name=file.slice(0,-4);
    const migration=await readFile(new URL(file,directory),'utf8');
    const hash=createHash('sha256').update(migration).digest('hex');
    const previous = await sql`select checksum from larparts_migrations.applied where name=${name}`;
    if (previous.length && previous[0].checksum !== hash) throw new Error('Applied migration checksum differs; add a new migration');
    if (!previous.length) {
      stage = `apply migration ${name}`;
      // Record migration atomically inside its explicit transaction.
      await sql.unsafe(migration.replace(/commit;\s*$/, `insert into larparts_migrations.applied(name,checksum) values ('${name}','${hash}');\ncommit;`));
    }
    }
    await sql`select pg_advisory_unlock(101001002)`;
  }
  stage = 'database policy tests';
  await sql.unsafe(await readFile(new URL('../supabase/tests/foundation.sql',import.meta.url),'utf8'));
  await sql.unsafe(await readFile(new URL('../supabase/tests/image-ingestion.sql',import.meta.url),'utf8'));
  await sql.unsafe(await readFile(new URL('../supabase/tests/verified-publication.sql',import.meta.url),'utf8'));
  await sql.unsafe(await readFile(new URL('../supabase/tests/legacy-import.sql',import.meta.url),'utf8'));
  stage = 'public Data API read';
  await readPublishedArtists(config);
  stage = 'private Data API denial';
  const denied = await fetch(new URL('/rest/v1/submissions?select=id&limit=1',config.SUPABASE_URL), {
    headers:{apikey:config.SUPABASE_PUBLISHABLE_KEY,'Accept-Profile':'private'},signal:AbortSignal.timeout(15000),
  });
  if (![401,403,406].includes(denied.status)) throw new Error('Private Data API did not explicitly deny access');
  console.log('PASS: testing database policy, uniqueness, audit, unpublish and restoration checks');
} catch (error) {
  // Provider exceptions may include SQL/connection data. Keep output private-safe.
  const code = (error as { code?: string }).code;
  const safeCode = code && /^[A-Z0-9_]{1,50}$/.test(code) ? ` (${code})` : '';
  const syscall = (error as { syscall?: string }).syscall;
  if (syscall && /^[a-zA-Z0-9_ ]{1,50}$/.test(syscall)) console.error(`Connection operation: ${syscall}`);
  console.error(`FAIL: testing database ${stage}${safeCode}. No credential or SQL values logged.`);
  process.exitCode = 1;
} finally { await sql.end({ timeout: 5 }); }
