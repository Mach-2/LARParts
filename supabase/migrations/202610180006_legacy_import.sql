begin;

-- Durable receipts prevent reruns from overwriting edits or resurrecting deleted imports.
create table private.legacy_profile_imports (
  artist_id text primary key check(artist_id ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  source_checksum text not null check(source_checksum ~ '^[a-f0-9]{64}$'),
  source_label text not null check(source_label ~ '^[a-zA-Z0-9_.-]{1,100}$'),
  profile jsonb not null check(private.valid_public_profile(profile)),
  state text not null default 'prepared' check(state in ('prepared','completed','conflict','abandoned')),
  photo_outcome text not null check(photo_outcome in ('none','copied','unavailable')),
  photo_failure text check(photo_failure in ('source_unavailable','invalid_image')),
  asset_id uuid unique references private.image_assets(id),
  image_sha256 text check(image_sha256 ~ '^[a-f0-9]{64}$'),
  imported_revision bigint,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  object_deleted_at timestamptz,
  check((photo_outcome='copied') = (asset_id is not null and image_sha256 is not null)),
  check((photo_outcome='unavailable') = (photo_failure is not null))
);

-- Factual historical records only: no tokens, ownership or claim eligibility.
-- Nullable consent fields deliberately do not invent evidence missing in the source.
create table private.historical_submissions (
  source_record_id text primary key check(source_record_id ~ '^[a-zA-Z0-9_.-]{1,100}$'),
  artist_id text not null references public.artist_profiles(id) on delete restrict,
  email text not null check(email=lower(btrim(email)) and length(email) between 3 and 254),
  consent_at timestamptz,
  consent_version text,
  upgrade_notifications boolean,
  source_label text not null check(source_label ~ '^[a-zA-Z0-9_.-]{1,100}$'),
  source_checksum text not null check(source_checksum ~ '^[a-f0-9]{64}$'),
  imported_at timestamptz not null default now()
);
alter table private.legacy_profile_imports enable row level security;
alter table private.historical_submissions enable row level security;
revoke all on private.legacy_profile_imports,private.historical_submissions from public,anon,authenticated,service_role;

-- SQL operator only. No API grants, security-definer escalation or public RPC.
create function private.legacy_profile_prepare(p jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare r private.legacy_profile_imports; asset_id uuid; image jsonb:=p->'asset';
begin
  perform pg_advisory_xact_lock(hashtextextended('legacy:'||(p->>'id'),0));
  select * into r from private.legacy_profile_imports where artist_id=p->>'id' for update;
  if found then return to_jsonb(r); end if;
  if exists(select 1 from public.artist_profiles where id=p->>'id') then return jsonb_build_object('state','existing'); end if;
  if image is not null and image <> 'null'::jsonb then
    asset_id:=gen_random_uuid();
    insert into private.image_assets(id,bucket,object_key,visibility,processing_state,content_type,byte_size,width,height)
    values(asset_id,image->>'bucket','legacy-imports/'||asset_id||'.webp','published','pending','image/webp',
      (image->>'byteSize')::int,(image->>'width')::int,(image->>'height')::int);
  end if;
  insert into private.legacy_profile_imports(artist_id,source_checksum,source_label,profile,photo_outcome,photo_failure,asset_id,image_sha256)
  values(p->>'id',p->>'checksum',p->>'sourceLabel',p->'profile',p->>'photoOutcome',p->>'photoFailure',asset_id,image->>'sha256')
  returning * into r;
  return to_jsonb(r);
end $$;

create function private.legacy_profile_commit(p_id text,p_checksum text,p_image_sha256 text) returns text
language plpgsql security invoker set search_path='' as $$
declare r private.legacy_profile_imports; next_revision bigint;
begin
  select * into r from private.legacy_profile_imports where artist_id=p_id for update;
  if not found or r.source_checksum<>p_checksum then raise exception 'Import receipt unavailable or source changed'; end if;
  if r.state<>'prepared' then return r.state; end if;
  if r.asset_id is not null then
    if p_image_sha256 is distinct from r.image_sha256 then raise exception 'Image digest mismatch'; end if;
    update private.image_assets set processing_state='processed' where id=r.asset_id and processing_state='pending';
    if not found then raise exception 'Import asset unavailable'; end if;
  end if;
  perform set_config('app.audit_actor','legacy-import',true);
  perform set_config('app.audit_reason','Insert approved legacy public profile from '||r.source_label,true);
  -- Covers both stable-ID races and normalized-name/kingdom conflicts.
  begin
    insert into public.artist_profiles(id,profile,status,image_asset_id)
    values(r.artist_id,r.profile,'published',r.asset_id) returning revision into next_revision;
  exception when unique_violation then
    -- Roll back BEFORE-trigger audit effects too; a failed attempt is not a revision.
    next_revision:=null;
  end;
  update private.legacy_profile_imports set state=case when next_revision is null then 'conflict' else 'completed' end,
    imported_revision=next_revision,completed_at=case when next_revision is not null then now() end where artist_id=p_id;
  return case when next_revision is null then 'conflict' else 'completed' end;
end $$;

-- Permanently abandon before deleting R2 objects, so interrupted cleanup is retryable.
create function private.legacy_profile_abandon(p_id text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare r private.legacy_profile_imports; a private.image_assets;
begin
  select * into r from private.legacy_profile_imports where artist_id=p_id for update;
  if not found or r.state='completed' then raise exception 'Cannot abandon completed or missing import'; end if;
  if r.asset_id is not null then
    if exists(select 1 from public.artist_profiles where image_asset_id=r.asset_id) or
       exists(select 1 from private.profile_audit where before_row->>'image_asset_id'=r.asset_id::text or after_row->>'image_asset_id'=r.asset_id::text)
    then raise exception 'Asset has current or historical profile references'; end if;
    select * into a from private.image_assets where id=r.asset_id;
  end if;
  update private.legacy_profile_imports set state='abandoned' where artist_id=p_id;
  return jsonb_build_object('asset',to_jsonb(a));
end $$;
revoke all on function private.legacy_profile_prepare(jsonb),
  private.legacy_profile_commit(text,text,text),private.legacy_profile_abandon(text)
  from public,anon,authenticated,service_role;
commit;
