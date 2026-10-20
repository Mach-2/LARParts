begin;

-- Run as postgres through migrations, never through an application API key.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to service_role;
revoke create on schema public from public, anon, authenticated;
-- Defaults apply to objects created by the migration/dashboard role.
alter default privileges for role postgres revoke all on tables from anon, authenticated;
alter default privileges for role postgres revoke all on sequences from public, anon, authenticated;
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
-- Function EXECUTE is global by default; a schema-local REVOKE cannot subtract it.
alter default privileges for role postgres revoke execute on functions from public, anon, authenticated;
alter default privileges for role postgres in schema public revoke execute on functions from public, anon, authenticated;
alter default privileges for role postgres in schema private revoke all on tables from public, anon, authenticated;
alter default privileges for role postgres in schema private revoke execute on functions from public, anon, authenticated;
alter default privileges for role postgres in schema private revoke all on sequences from public, anon, authenticated;

create table private.image_assets (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'r2' check (provider = 'r2'),
  bucket text not null check (length(btrim(bucket)) > 0),
  object_key text not null check (object_key ~ '^[a-zA-Z0-9_-]+(/[a-zA-Z0-9_.-]+)*$' and object_key !~ '(^|/)\.{1,2}(/|$)'),
  visibility text not null check (visibility in ('temporary', 'published')),
  processing_state text not null default 'pending' check (processing_state in ('pending', 'processed', 'failed', 'deleted')),
  content_type text check (content_type in ('image/jpeg', 'image/png', 'image/webp')),
  byte_size integer check (byte_size > 0 and byte_size <= 5242880),
  width integer check (width > 0 and width <= 10000),
  height integer check (height > 0 and height <= 10000),
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  unique (bucket, object_key),
  check (processing_state <> 'processed' or (width is not null and height is not null and width::bigint * height <= 40000000 and byte_size is not null and content_type is not null))
);

-- An allowlist prevents accidental private fields in the public JSON document.
create function private.valid_public_profile(p jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare k text; v jsonb;
begin
  if jsonb_typeof(p) is distinct from 'object' then return false; end if;
  if not (p ?& array['displayName','awards','skills','contact']) then return false; end if;
  for k,v in select * from jsonb_each(p) loop
    if k in ('displayName','kingdom','homePark','memberSince','biography') then
      if jsonb_typeof(v) <> 'string' or length(btrim(v #>> '{}')) = 0 then return false; end if;
    elsif k in ('awards','skills') then
      if jsonb_typeof(v) <> 'array' then return false; end if;
      if exists (select 1 from jsonb_array_elements(v) x where jsonb_typeof(x) <> 'string' or length(btrim(x #>> '{}')) = 0) then return false; end if;
    elsif k = 'contact' then
      if jsonb_typeof(v) <> 'object' then return false; end if;
      if exists (select 1 from jsonb_each(v) c where c.key <> all(array['website','instagram','facebook','discord','tiktok','other']) or jsonb_typeof(c.value) <> 'string' or length(btrim(c.value #>> '{}')) = 0) then return false; end if;
    else return false;
    end if;
  end loop;
  return true;
end $$;
revoke all on function private.valid_public_profile(jsonb) from public, anon, authenticated;
grant execute on function private.valid_public_profile(jsonb) to service_role;

create table public.artist_profiles (
  id text primary key check (id ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  profile jsonb not null check (private.valid_public_profile(profile)),
  status text not null default 'unpublished' check (status in ('published', 'unpublished')),
  image_asset_id uuid references private.image_assets(id) on delete restrict,
  photo_key text,
  revision bigint not null default 1,
  updated_at timestamptz not null default now()
);
create unique index artist_profiles_identity on public.artist_profiles
  (lower(regexp_replace(btrim(profile->>'displayName'), '\s+', ' ', 'g')),
   lower(regexp_replace(btrim(coalesce(profile->>'kingdom','')), '\s+', ' ', 'g')));

create table private.submissions (
  id uuid primary key default gen_random_uuid(),
  artist_id text references public.artist_profiles(id) on delete restrict,
  proposed_profile jsonb not null check (private.valid_public_profile(proposed_profile)),
  email text not null check (email = lower(btrim(email)) and length(email) between 3 and 254),
  consent_at timestamptz not null,
  consent_version text not null,
  upgrade_notifications boolean not null default false,
  source text not null default 'new' check (source in ('new', 'historical')),
  state text not null default 'pending' check (state in ('pending','publishing','published','expired','failed')),
  image_asset_id uuid references private.image_assets(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours')
);
create table private.verification_tokens (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references private.submissions(id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  check (expires_at > created_at and expires_at <= created_at + interval '24 hours')
);
create table private.notification_jobs (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references private.submissions(id),
  kind text not null check (kind in ('confirmation','administrator')),
  deduplication_key text not null unique,
  state text not null default 'pending' check (state in ('pending','leased','sent','failed')),
  attempts integer not null default 0 check (attempts >= 0),
  available_at timestamptz not null default now(),
  lease_until timestamptz,
  sent_at timestamptz,
  last_error_code text,
  created_at timestamptz not null default now()
);
create index notification_jobs_pending on private.notification_jobs(available_at) where state in ('pending','leased');
create table private.profile_audit (
  id bigint generated always as identity primary key,
  artist_id text not null,
  operation text not null,
  actor text not null,
  database_role text not null,
  reason text not null,
  before_row jsonb,
  after_row jsonb,
  created_at timestamptz not null default now()
);

create function private.audit_profile_change() returns trigger language plpgsql
security definer set search_path = '' as $$
declare actor text := nullif(btrim(current_setting('app.audit_actor',true)), '');
        reason text := nullif(btrim(current_setting('app.audit_reason',true)), '');
        asset private.image_assets;
begin
  if actor is null or reason is null then raise exception 'Audit actor and reason required'; end if;
  if tg_op <> 'DELETE' then
    if tg_op = 'UPDATE' and new.id <> old.id then raise exception 'Artist IDs are immutable'; end if;
    new.photo_key := null;
    if new.image_asset_id is not null then
      select * into asset from private.image_assets where id = new.image_asset_id;
      if asset.visibility <> 'published' or asset.processing_state <> 'processed' then raise exception 'Image must be processed and published'; end if;
      new.photo_key := asset.object_key;
    end if;
    new.revision := case when tg_op = 'INSERT' then 1 else old.revision + 1 end;
    new.updated_at := clock_timestamp();
  end if;
  insert into private.profile_audit(artist_id,operation,actor,database_role,reason,before_row,after_row)
  values (case when tg_op = 'DELETE' then old.id else new.id end, tg_op,actor,
    coalesce(nullif(current_setting('role',true),'none'),session_user),reason,
    case when tg_op <> 'INSERT' then to_jsonb(old) end,
    case when tg_op <> 'DELETE' then to_jsonb(new) end);
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
revoke all on function private.audit_profile_change() from public, anon, authenticated, service_role;
create trigger audit_profile before insert or update or delete on public.artist_profiles
for each row execute function private.audit_profile_change();

alter table public.artist_profiles enable row level security;
revoke all on public.artist_profiles from public, anon, authenticated;
grant select on public.artist_profiles to anon, authenticated;
grant select, insert, update, delete on public.artist_profiles to service_role;
create policy published_read on public.artist_profiles for select to anon, authenticated using (status = 'published');

do $$ declare t text; begin
  foreach t in array array['image_assets','submissions','verification_tokens','notification_jobs','profile_audit'] loop
    execute format('alter table private.%I enable row level security', t);
    execute format('revoke all on private.%I from public, anon, authenticated, service_role',t);
  end loop;
end $$;
grant select, insert, update, delete on private.image_assets, private.submissions, private.verification_tokens, private.notification_jobs to service_role;
-- Audit insertion is trigger-only. Even the application cannot alter history.
grant select on private.profile_audit to service_role;

-- Restricted SQL editor operations; no Data API RPC or custom admin UI.
create function private.admin_change_profile(
  p_id text, p_expected_revision bigint, p_profile jsonb, p_status text,
  p_image_asset_id uuid, p_actor text, p_reason text
) returns bigint language plpgsql security invoker set search_path = '' as $$
declare next_revision bigint;
begin
  if nullif(btrim(p_actor),'') is null or nullif(btrim(p_reason),'') is null then raise exception 'Audit actor and reason required'; end if;
  perform set_config('app.audit_actor',p_actor,true);
  perform set_config('app.audit_reason',p_reason,true);
  update public.artist_profiles set profile=p_profile,status=p_status,image_asset_id=p_image_asset_id
  where id=p_id and revision=p_expected_revision returning revision into next_revision;
  if not found then raise exception 'Profile missing or revision conflict'; end if;
  return next_revision;
end $$;
revoke all on function private.admin_change_profile(text,bigint,jsonb,text,uuid,text,text) from public, anon, authenticated, service_role;

create function private.admin_restore_profile(
  p_id text, p_expected_revision bigint, p_audit_id bigint, p_actor text, p_reason text
) returns bigint language plpgsql security invoker set search_path = '' as $$
declare snapshot jsonb;
begin
  -- Restore an audited prior public state while preserving current history/revision.
  select before_row into snapshot from private.profile_audit where id=p_audit_id and artist_id=p_id;
  if snapshot is null then raise exception 'Prior profile snapshot unavailable'; end if;
  return private.admin_change_profile(p_id,p_expected_revision,snapshot->'profile',snapshot->>'status',
    (snapshot->>'image_asset_id')::uuid,p_actor,p_reason);
end $$;
revoke all on function private.admin_restore_profile(text,bigint,bigint,text,text) from public, anon, authenticated, service_role;

commit;
