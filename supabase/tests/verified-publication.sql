begin;
set local role anon;
do $$ begin
  if has_function_privilege(current_user,'public.publication_operation(text,uuid,text,jsonb)','execute') then raise exception 'Public publication RPC exposed'; end if;
end $$;
reset role;
set local role authenticated;
do $$ begin
  if has_function_privilege(current_user,'public.publication_operation(text,uuid,text,jsonb)','execute') or has_schema_privilege(current_user,'private','usage') then raise exception 'Authenticated private access exposed'; end if;
end $$;
reset role;
set local role service_role;
select public.publication_operation('submit','00000000-0000-4000-8000-000000000004',repeat('a',64),
  '{"profile":{"displayName":"Synthetic Verified SQL Test","kingdom":"Testing","awards":[],"skills":[],"contact":{}},"email":"synthetic@example.invalid","upgradeNotifications":false,"requestHash":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","tokenId":"00000000-0000-4000-8000-000000000044","tokenHash":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","mail":{"origin":"https://example.invalid","from":"synthetic@example.invalid","to":["synthetic@example.invalid"]}}');
do $$ declare s jsonb; begin
  begin
    perform public.publication_operation('status','00000000-0000-4000-8000-000000000004',repeat('d',64));raise exception 'Wrong submission capability accepted';
  exception when raise_exception then if sqlerrm<>'Submission unavailable' then raise; end if; end;
  begin
    perform public.publication_operation('confirm_claim','00000000-0000-4000-8000-000000000004',repeat('d',64),'{}');raise exception 'Wrong email token accepted';
  exception when raise_exception then if sqlerrm<>'Confirmation unavailable' then raise; end if; end;
  begin
    perform public.publication_operation('resend','00000000-0000-4000-8000-000000000004',repeat('a',64),'{}');raise exception 'Resend cooldown bypassed';
  exception when raise_exception then if sqlerrm<>'Resend unavailable' then raise; end if; end;
  s:=public.publication_operation('confirm_claim','00000000-0000-4000-8000-000000000004',repeat('c',64),'{"publishedBucket":"synthetic-published"}');
  if s->>'state'<>'claimed' then raise exception 'Confirmation claim failed'; end if;
  if public.publication_operation('confirm_claim','00000000-0000-4000-8000-000000000004',repeat('c',64),'{}')->>'state'<>'processing' then raise exception 'Concurrent worker lease allowed'; end if;
  s:=public.publication_operation('commit','00000000-0000-4000-8000-000000000004',null,jsonb_build_object('lease',s->'intent'->>'lease_id','mail','{}'::jsonb));
  if s->>'state'<>'published' then raise exception 'Atomic publication failed'; end if;
  if public.publication_operation('confirm_claim','00000000-0000-4000-8000-000000000004',repeat('c',64),'{}')->>'state'<>'published' then raise exception 'Idempotent confirmation failed'; end if;
end $$;
reset role;
do $$ begin
  if not exists(select 1 from public.artist_profiles where id='artist-00000000000040008000000000000004' and status='published') then raise exception 'Published row missing'; end if;
  if (select count(*) from private.notification_jobs where submission_id='00000000-0000-4000-8000-000000000004' and kind='administrator')<>1 then raise exception 'Administrator outbox not exactly once'; end if;
  if not exists(select 1 from private.verification_tokens where id='00000000-0000-4000-8000-000000000044' and consumed_at is not null) then raise exception 'Token not consumed with publication'; end if;
  if not exists(select 1 from private.profile_audit where artist_id='artist-00000000000040008000000000000004' and actor='email-confirmed-publication') then raise exception 'Publication not audited'; end if;
end $$;
rollback;
