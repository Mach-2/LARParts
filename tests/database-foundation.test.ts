import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

test('migration enforces actual PostgreSQL RLS, grants, identity constraints and audit restoration', async () => {
  const db = new PGlite();
  try {
    await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
    await db.exec(await readFile(new URL('../supabase/migrations/202610180001_foundation.sql',import.meta.url),'utf8'));
    await db.exec(await readFile(new URL('../supabase/migrations/202610180002_image_ingestion.sql',import.meta.url),'utf8'));
    await db.exec(await readFile(new URL('../supabase/migrations/202610180003_verified_publication.sql',import.meta.url),'utf8'));
    await db.exec(await readFile(new URL('../supabase/migrations/202610180004_publication_mail_aliases.sql',import.meta.url),'utf8'));
    await db.exec(await readFile(new URL('../supabase/migrations/202610180005_publication_cleanup_aliases.sql',import.meta.url),'utf8'));
    await db.exec(await readFile(new URL('../supabase/migrations/202610180006_legacy_import.sql',import.meta.url),'utf8'));
    await db.exec(await readFile(new URL('../supabase/migrations/202610190007_notification_preference.sql',import.meta.url),'utf8'));
    await db.exec(await readFile(new URL('../supabase/tests/foundation.sql',import.meta.url),'utf8'));
    await db.exec(await readFile(new URL('../supabase/tests/image-ingestion.sql',import.meta.url),'utf8'));
    await db.exec(await readFile(new URL('../supabase/tests/verified-publication.sql',import.meta.url),'utf8'));
    await db.exec(await readFile(new URL('../supabase/tests/legacy-import.sql',import.meta.url),'utf8'));
    const result = await db.query<{ count: number }>('select count(*)::int as count from public.artist_profiles');
    assert.equal(result.rows[0].count,0,'Policy fixtures must be rolled back');
    await db.exec('create table public.future_table(id int); create function public.future_function() returns int language sql as $$ select 1 $$;');
    const grants = await db.query<{ tables: boolean; functions: boolean }>("select has_table_privilege('anon','public.future_table','select') as tables, has_function_privilege('anon','public.future_function()','execute') as functions");
    assert.deepEqual(grants.rows[0],{tables:false,functions:false});
  } finally { await db.close(); }
});
