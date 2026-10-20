begin;
create table private.image_sessions (
  id uuid primary key,
  capability_hash text not null check (capability_hash ~ '^[a-f0-9]{64}$'),
  mode text not null check (mode in ('upload','remote')),
  expected_bytes integer check (expected_bytes between 1 and 5242880),
  expected_type text check (expected_type in ('image/jpeg','image/png','image/webp')),
  state text not null default 'pending' check (state in ('pending','processing','ready','failed','deleting','deleted')),
  lease_id uuid,
  lease_until timestamptz,
  attempts integer not null default 0,
  asset_id uuid references private.image_assets(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '48 hours'),
  check (mode <> 'upload' or (expected_bytes is not null and expected_type is not null))
);
create index image_sessions_cleanup on private.image_sessions(expires_at) where state <> 'deleted';
create table private.image_rate_limits (
  fingerprint text not null,
  window_start timestamptz not null,
  count integer not null,
  primary key(fingerprint,window_start)
);
alter table private.image_sessions enable row level security;
alter table private.image_rate_limits enable row level security;
revoke all on private.image_sessions, private.image_rate_limits from public, anon, authenticated, service_role;

-- Only this narrowly scoped server RPC is exposed. Private schemas stay unexposed.
create function public.image_session_operation(p_action text, p_id uuid default null,
  p_hash text default null, p_data jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s private.image_sessions; n integer; result jsonb; lease uuid;
begin
  if p_action = 'rate' then
    if (p_data->>'fingerprint') !~ '^[a-f0-9]{64}$' then raise exception 'Invalid rate fingerprint'; end if;
    insert into private.image_rate_limits(fingerprint,window_start,count)
    values(p_data->>'fingerprint',date_trunc('hour',now()),1)
    on conflict(fingerprint,window_start) do update set count=image_rate_limits.count+1
    returning count into n;
    -- Return rather than raise: over-limit attempts must still be persisted.
    return jsonb_build_object('allowed',n <= 60);
  elsif p_action = 'start' then
    -- One upload slot/capability belongs to one future submission, never an artist account.
    insert into private.image_sessions(id,capability_hash,mode,expected_bytes,expected_type)
    values(p_id,p_hash,p_data->>'mode',(p_data->>'bytes')::integer,p_data->>'type') returning * into s;
    return to_jsonb(s);
  elsif p_action = 'cleanup_claim' then
    delete from private.image_rate_limits where window_start < now()-interval '2 days';
    with candidates as (
      select x.id from private.image_sessions x
      where x.expires_at < now() and x.state <> 'deleted'
        and (x.lease_until is null or x.lease_until < now())
        and not exists(select 1 from public.artist_profiles a where a.image_asset_id=x.asset_id)
        and not exists(select 1 from private.submissions a where a.image_asset_id=x.asset_id
          and (a.expires_at > now() or a.state in ('publishing','published')))
      order by x.expires_at for update skip locked limit 20
    ), claimed as (
      update private.image_sessions x set state='deleting',lease_id=gen_random_uuid(),lease_until=now()+interval '10 minutes'
      from candidates c where x.id=c.id returning x.*
    ) select coalesce(jsonb_agg(to_jsonb(claimed)),'[]') into result from claimed;
    return result;
  end if;
  select * into s from private.image_sessions where id=p_id for update;
  if not found then raise exception 'Image session unavailable'; end if;
  if p_action = 'cleanup_done' then
    if s.state <> 'deleting' or s.lease_id is distinct from (p_data->>'lease')::uuid then raise exception 'Image session unavailable'; end if;
    update private.image_assets set processing_state='deleted' where id=s.asset_id;
    update private.image_sessions set state='deleted',capability_hash=repeat('0',64),lease_until=null where id=s.id;
    return '{}';
  end if;
  if s.capability_hash is distinct from p_hash or s.expires_at <= now() or s.state in ('deleting','deleted') then raise exception 'Image session unavailable'; end if;
  if p_action = 'get' then return to_jsonb(s); end if;
  if p_action = 'claim' then
    if s.state='ready' then return to_jsonb(s); end if;
    if s.state='failed' or s.attempts>=3 or (s.state='processing' and s.lease_until>now()) then raise exception 'Image processing unavailable'; end if;
    lease := gen_random_uuid();
    update private.image_sessions set state='processing',lease_id=lease,lease_until=now()+interval '10 minutes',attempts=attempts+1
    where id=s.id returning * into s;
    return to_jsonb(s);
  end if;
  if s.state <> 'processing' or s.lease_id is distinct from (p_data->>'lease')::uuid or s.lease_until<=now() then raise exception 'Image processing unavailable'; end if;
  if p_action = 'finish' then
    insert into private.image_assets(id,bucket,object_key,visibility,processing_state,content_type,byte_size,width,height,expires_at)
    values(s.id,p_data->>'bucket','processed/'||s.id||'/'||s.lease_id||'.webp','temporary','processed','image/webp',
      (p_data->>'bytes')::integer,(p_data->>'width')::integer,(p_data->>'height')::integer,s.expires_at);
    update private.image_sessions set state='ready',asset_id=s.id,lease_until=null where id=s.id returning * into s;
    return to_jsonb(s);
  elsif p_action = 'fail' then
    update private.image_sessions set state='failed',lease_until=null where id=s.id;
    return '{}';
  end if;
  raise exception 'Unknown image operation';
end $$;
revoke all on function public.image_session_operation(text,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.image_session_operation(text,uuid,text,jsonb) to service_role;
commit;
