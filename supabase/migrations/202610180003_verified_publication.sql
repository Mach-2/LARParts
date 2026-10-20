begin;
alter table private.submissions add column capability_hash text check(capability_hash ~ '^[a-f0-9]{64}$');
alter table private.submissions add column request_hash text check(request_hash ~ '^[a-f0-9]{64}$');
alter table private.submissions add column confirmed_at timestamptz;
alter table private.submissions add column publication_deadline timestamptz not null default (now()+interval '5 days');
alter table private.submissions add column authorized_token_id uuid references private.verification_tokens(id);
alter table private.submissions add column resend_count integer not null default 0;
alter table private.submissions add column last_confirmation_at timestamptz not null default now();
alter table private.image_sessions add column submission_id uuid unique references private.submissions(id);
alter table private.verification_tokens add column revoked_at timestamptz;
alter table private.notification_jobs add column token_id uuid references private.verification_tokens(id);
alter table private.notification_jobs add column lease_id uuid;
alter table private.notification_jobs add column first_attempt_at timestamptz;
alter table private.notification_jobs add column payload jsonb not null default '{}';
create table private.submission_rate_limits(
  fingerprint text not null check(fingerprint ~ '^[a-f0-9]{64}$'),
  window_start timestamptz not null,count integer not null,primary key(fingerprint,window_start)
);
create table private.publication_intents(
  submission_id uuid primary key references private.submissions(id),
  asset_id uuid not null unique default gen_random_uuid(),
  bucket text not null,object_key text not null unique,
  digest text check(digest ~ '^[a-f0-9]{64}$'),
  cleanup_after timestamptz,
  state text not null default 'planned' check(state in ('planned','committed','orphan','deleting','deleted')),
  lease_id uuid,lease_until timestamptz,attempts integer not null default 0,
  created_at timestamptz not null default now()
);
alter table private.submission_rate_limits enable row level security;
alter table private.publication_intents enable row level security;
revoke all on private.submission_rate_limits,private.publication_intents from public,anon,authenticated,service_role;

create function private.queue_profile_verification(s private.submissions, token_id uuid, hash text, context jsonb)
returns void language plpgsql set search_path='' as $$
begin
  insert into private.verification_tokens(id,submission_id,token_hash,expires_at)
  values(token_id,s.id,hash,now()+interval '24 hours');
  insert into private.notification_jobs(submission_id,kind,deduplication_key,token_id,payload)
  values(s.id,'confirmation','confirmation/'||token_id,token_id,
    context||jsonb_build_object('to',jsonb_build_array(s.email),'displayName',s.proposed_profile->>'displayName'));
end $$;
revoke all on function private.queue_profile_verification(private.submissions,uuid,text,jsonb) from public,anon,authenticated,service_role;

create function public.publication_operation(p_action text,p_id uuid default null,p_hash text default null,p_data jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare s private.submissions; im private.image_sessions; a private.image_assets;
  intent private.publication_intents; t private.verification_tokens; job private.notification_jobs;
  n integer; result jsonb; artist text; lease uuid;
begin
  if p_action='rate' then
    if (p_data->>'limit')::integer not between 1 and 60 then raise exception 'Invalid limit'; end if;
    insert into private.submission_rate_limits(fingerprint,window_start,count)
    values(p_data->>'fingerprint',date_trunc('hour',now()),1)
    on conflict(fingerprint,window_start) do update set count=submission_rate_limits.count+1 returning count into n;
    return jsonb_build_object('allowed',n <= (p_data->>'limit')::integer);
  elsif p_action='submit' then
    perform pg_advisory_xact_lock(hashtextextended(p_id::text,0));
    select * into s from private.submissions where id=p_id for update;
    if found then
      if s.capability_hash is distinct from p_hash or s.request_hash is distinct from p_data->>'requestHash' then raise exception 'Submission unavailable'; end if;
      return jsonb_build_object('state',s.state,'submissionId',s.id);
    end if;
    if exists(select 1 from public.artist_profiles x where
      lower(regexp_replace(btrim(x.profile->>'displayName'),'\s+',' ','g'))=lower(regexp_replace(btrim(p_data->'profile'->>'displayName'),'\s+',' ','g')) and
      lower(regexp_replace(btrim(coalesce(x.profile->>'kingdom','')),'\s+',' ','g'))=lower(regexp_replace(btrim(coalesce(p_data->'profile'->>'kingdom','')),'\s+',' ','g'))) then raise exception 'Artist identity already exists'; end if;
    if p_data->>'imageSessionId' is not null then
      select * into im from private.image_sessions where id=(p_data->>'imageSessionId')::uuid for update;
      if not found or im.capability_hash is distinct from p_data->>'imageHash' or im.state<>'ready' or im.expires_at<=now() or im.submission_id is not null then raise exception 'Image unavailable'; end if;
      select * into a from private.image_assets where id=im.asset_id;
      if a.processing_state<>'processed' or a.visibility<>'temporary' or a.bucket is distinct from p_data->>'temporaryBucket' then raise exception 'Image unavailable'; end if;
    end if;
    insert into private.submissions(id,proposed_profile,email,consent_at,consent_version,upgrade_notifications,image_asset_id,capability_hash,request_hash,publication_deadline)
    values(p_id,p_data->'profile',p_data->>'email',now(),'v1.0.1-2026-10-18',(p_data->>'upgradeNotifications')::boolean,im.asset_id,p_hash,p_data->>'requestHash',least(now()+interval '5 days',coalesce(a.created_at+interval '6 days',now()+interval '5 days'))) returning * into s;
    if im.id is not null then update private.image_sessions set submission_id=s.id,expires_at=greatest(expires_at,now()+interval '48 hours') where id=im.id; end if;
    perform private.queue_profile_verification(s,(p_data->>'tokenId')::uuid,p_data->>'tokenHash',p_data->'mail');
    return jsonb_build_object('state','pending','submissionId',s.id);
  elsif p_action='mail_claim' then
    -- Stop before Resend's 24h deduplication window lapses. Ambiguous older jobs
    -- require operator reconciliation, never an unbounded automatic resend.
    update private.notification_jobs set state='failed',last_error_code='retry_window_exhausted'
    where state in ('pending','leased') and (first_attempt_at<now()-interval '23 hours' or attempts>=10)
      and (lease_until is null or lease_until<now());
    with candidates as (
      select j.id from private.notification_jobs j where (p_id is null or j.submission_id=p_id)
      and ((j.state='pending' and j.available_at<=now()) or (j.state='leased' and j.lease_until<now()))
      and (j.kind='administrator' or exists(select 1 from private.verification_tokens v join private.submissions s on s.id=v.submission_id where v.id=j.token_id and s.state='pending' and v.revoked_at is null and v.consumed_at is null and v.expires_at>now()))
      order by j.created_at for update skip locked limit 5
    ), claimed as (
      update private.notification_jobs j set state='leased',lease_id=gen_random_uuid(),lease_until=now()+interval '5 minutes',attempts=attempts+1,first_attempt_at=coalesce(first_attempt_at,now())
      from candidates c where j.id=c.id returning j.*
    ) select coalesce(jsonb_agg(to_jsonb(claimed)),'[]') into result from claimed;
    return result;
  elsif p_action in ('mail_done','mail_retry') then
    select * into job from private.notification_jobs where id=p_id for update;
    if job.state<>'leased' or job.lease_id is distinct from (p_data->>'lease')::uuid then raise exception 'Job lease unavailable'; end if;
    update private.notification_jobs set state=case when p_action='mail_done' then 'sent' else 'pending' end,
      sent_at=case when p_action='mail_done' then now() else null end,lease_until=null,
      available_at=now()+make_interval(secs=>least(3600,power(2,least(attempts,10))::integer*60)),
      last_error_code=case when p_action='mail_done' then null else 'delivery_failed' end where id=p_id;
    return '{}';
  elsif p_action='maintenance' then
    delete from private.submission_rate_limits where window_start<now()-interval '2 days';
    update private.submissions set state='expired' where state='pending' and expires_at<=now();
    update private.submissions x set state='failed' from private.publication_intents i
      where x.id=i.submission_id and x.state='publishing' and (i.attempts>=10 or x.publication_deadline<=now()) and i.lease_until<now();
    update private.publication_intents i set state='orphan',cleanup_after=now()+interval '1 day' from private.submissions x where x.id=i.submission_id and x.state in ('failed','expired') and i.state='planned' and (i.lease_until is null or i.lease_until<now());
    -- Expired/revoked confirmation jobs must not remain a misleading pending queue.
    update private.notification_jobs j set state='failed',last_error_code='token_unavailable' where j.kind='confirmation' and j.state='pending' and exists(
      select 1 from private.verification_tokens t join private.submissions s on s.id=t.submission_id where t.id=j.token_id and (s.state<>'pending' or t.revoked_at is not null or t.consumed_at is not null or t.expires_at<=now()));
    return '{}';
  elsif p_action='orphan_claim' then
    with candidates as (
      select i.submission_id from private.publication_intents i where i.cleanup_after<=now() and (i.state='orphan' or (i.state='deleting' and i.lease_until<now()))
      and not exists(select 1 from public.artist_profiles a where a.image_asset_id=i.asset_id)
      for update skip locked limit 20
    ), claimed as (
      update private.publication_intents i set state='deleting',lease_id=gen_random_uuid(),lease_until=now()+interval '10 minutes'
      from candidates c where i.submission_id=c.submission_id returning i.*
    )select coalesce(jsonb_agg(to_jsonb(claimed)),'[]') into result from claimed; return result;
  elsif p_action='orphan_done' then
    update private.publication_intents set state='deleted',lease_until=null where submission_id=p_id and state='deleting' and lease_id=(p_data->>'lease')::uuid;
    if not found then raise exception 'Orphan lease unavailable'; end if; return '{}';
  elsif p_action='recover_claim' then
    select x.* into s from private.submissions x join private.publication_intents i on i.submission_id=x.id
      where x.state='publishing' and i.state='planned' and i.lease_until<now() and i.attempts<10 and x.publication_deadline>now()
      order by x.confirmed_at for update of x skip locked limit 1;
    if not found then return null; end if;
  else
    select * into s from private.submissions where id=p_id for update;
    if not found or s.source<>'new' then raise exception 'Submission unavailable'; end if;
  end if;
  if p_action in ('status','resend') then
    if s.capability_hash is distinct from p_hash then raise exception 'Submission unavailable'; end if;
    if p_action='status' then return jsonb_build_object('state',s.state,'artistId',s.artist_id); end if;
    if s.state<>'pending' or s.expires_at<=now() or s.last_confirmation_at>now()-interval '5 minutes' or s.resend_count>=3 or s.publication_deadline<now()+interval '24 hours' then raise exception 'Resend unavailable'; end if;
    update private.verification_tokens set revoked_at=now() where submission_id=s.id and consumed_at is null and revoked_at is null;
    update private.submissions set resend_count=resend_count+1,last_confirmation_at=now(),expires_at=now()+interval '24 hours' where id=s.id returning * into s;
    perform private.queue_profile_verification(s,(p_data->>'tokenId')::uuid,p_data->>'tokenHash',p_data->'mail');
    return jsonb_build_object('state','pending');
  end if;
  if p_action='confirm_claim' then
    select * into t from private.verification_tokens where submission_id=s.id and token_hash=p_hash and revoked_at is null;
    if not found then raise exception 'Confirmation unavailable'; end if;
    if s.state='published' and s.authorized_token_id=t.id then return jsonb_build_object('state','published','artistId',s.artist_id); end if;
    if s.state='pending' then
      if t.consumed_at is not null or t.expires_at<=now() or s.expires_at<=now() or s.publication_deadline<=now() then raise exception 'Confirmation unavailable'; end if;
      update private.submissions set state='publishing',confirmed_at=now(),authorized_token_id=t.id where id=s.id returning * into s;
      insert into private.publication_intents(submission_id,bucket,object_key)
      values(s.id,p_data->>'publishedBucket','profiles/'||s.id||'.webp');
    elsif s.state<>'publishing' or s.authorized_token_id is distinct from t.id then raise exception 'Confirmation unavailable'; end if;
  end if;
  select * into intent from private.publication_intents where submission_id=s.id for update;
  if p_action in ('confirm_claim','recover_claim') then
    if intent.state<>'planned' or intent.attempts>=10 or s.publication_deadline<=now() then raise exception 'Publication unavailable'; end if;
    if intent.lease_until>now() then return jsonb_build_object('state','processing'); end if;
    lease:=gen_random_uuid();
    update private.publication_intents set lease_id=lease,lease_until=now()+interval '5 minutes',attempts=attempts+1 where submission_id=s.id returning * into intent;
    select * into a from private.image_assets where id=s.image_asset_id;
    return jsonb_build_object('state','claimed','submissionId',s.id,'intent',to_jsonb(intent),'source',case when a.id is not null then to_jsonb(a) end,'profile',s.proposed_profile);
  end if;
  if s.state='published' and p_action='commit' then return jsonb_build_object('state','published','artistId',s.artist_id); end if;
  if s.state<>'publishing' or intent.state<>'planned' or intent.lease_id is distinct from (p_data->>'lease')::uuid or intent.lease_until<=now() then raise exception 'Publication lease unavailable'; end if;
  if p_action='digest' then
    if intent.digest is not null and intent.digest is distinct from p_data->>'digest' then raise exception 'Asset digest mismatch'; end if;
    update private.publication_intents set digest=p_data->>'digest' where submission_id=s.id; return '{}';
  elsif p_action='commit' then
    artist:='artist-'||replace(s.id::text,'-','');
    begin
      if s.image_asset_id is not null then
        if intent.digest is null then raise exception 'Promotion digest required'; end if;
        select * into a from private.image_assets where id=s.image_asset_id;
        insert into private.image_assets(id,bucket,object_key,visibility,processing_state,content_type,byte_size,width,height)
        values(intent.asset_id,intent.bucket,intent.object_key,'published','processed',a.content_type,a.byte_size,a.width,a.height);
      end if;
      perform set_config('app.audit_actor','email-confirmed-publication',true);
      perform set_config('app.audit_reason','Explicit POST email confirmation',true);
      insert into public.artist_profiles(id,profile,status,image_asset_id) values(artist,s.proposed_profile,'published',case when s.image_asset_id is not null then intent.asset_id end);
    exception when unique_violation then
      update private.submissions set state='failed' where id=s.id;
      update private.publication_intents set state='orphan',lease_until=null,cleanup_after=now()+interval '1 day' where submission_id=s.id;
      return jsonb_build_object('state','conflict');
    end;
    update private.verification_tokens set consumed_at=now() where id=s.authorized_token_id and consumed_at is null;
    update private.submissions set state='published',artist_id=artist,image_asset_id=case when s.image_asset_id is not null then intent.asset_id end where id=s.id;
    update private.publication_intents set state='committed',lease_until=null where submission_id=s.id;
    insert into private.notification_jobs(submission_id,kind,deduplication_key,payload)
    values(s.id,'administrator','published/'||s.id,p_data->'mail'||jsonb_build_object('artistId',artist,'displayName',s.proposed_profile->>'displayName'));
    return jsonb_build_object('state','published','artistId',artist);
  end if;
  raise exception 'Unknown publication operation';
end $$;
revoke all on function public.publication_operation(text,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.publication_operation(text,uuid,text,jsonb) to service_role;
commit;
