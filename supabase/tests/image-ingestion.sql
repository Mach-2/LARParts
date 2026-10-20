begin;
set local role anon;
do $$ begin
  begin
    perform public.image_session_operation('start'); raise exception 'Anonymous RPC permitted';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role authenticated;
do $$ begin
  if has_function_privilege(current_user,'public.image_session_operation(text,uuid,text,jsonb)','execute') or has_schema_privilege(current_user,'private','usage') then raise exception 'Private image privileges leaked'; end if;
end $$;
reset role;
set local role service_role;
select public.image_session_operation('start','00000000-0000-4000-8000-000000000003',repeat('a',64),'{"mode":"upload","bytes":100,"type":"image/png"}');
do $$ declare s jsonb; lease text; i integer; begin
  begin
    perform public.image_session_operation('get','00000000-0000-4000-8000-000000000003',repeat('b',64)); raise exception 'Wrong capability accepted';
  exception when raise_exception then if sqlerrm<>'Image session unavailable' then raise; end if; end;
  s:=public.image_session_operation('claim','00000000-0000-4000-8000-000000000003',repeat('a',64)); lease:=s->>'lease_id';
  begin
    perform public.image_session_operation('finish','00000000-0000-4000-8000-000000000003',repeat('a',64),'{"lease":"00000000-0000-4000-8000-000000000099"}'); raise exception 'Wrong worker lease accepted';
  exception when raise_exception then if sqlerrm<>'Image processing unavailable' then raise; end if; end;
  begin
    perform public.image_session_operation('claim','00000000-0000-4000-8000-000000000003',repeat('a',64)); raise exception 'Concurrent claim accepted';
  exception when raise_exception then if sqlerrm<>'Image processing unavailable' then raise; end if; end;
  s:=public.image_session_operation('finish','00000000-0000-4000-8000-000000000003',repeat('a',64),
    jsonb_build_object('lease',lease,'bucket','synthetic-temporary','bytes',100,'width',10,'height',10));
  if s->>'state'<>'ready' then raise exception 'Completion failed'; end if;
  s:=public.image_session_operation('claim','00000000-0000-4000-8000-000000000003',repeat('a',64));
  if s->>'state'<>'ready' or s->>'lease_id'<>lease then raise exception 'Idempotent result changed'; end if;
  for i in 1..61 loop
    s:=public.image_session_operation('rate',null,null,jsonb_build_object('fingerprint',repeat('f',64)));
  end loop;
  if s->>'allowed'<>'false' then raise exception 'Rate limiter failed'; end if;
end $$;
reset role;
update private.image_sessions set expires_at=now()-interval '1 second' where id='00000000-0000-4000-8000-000000000003';
insert into private.submissions(proposed_profile,email,consent_at,consent_version,image_asset_id)
values('{"displayName":"Synthetic Image Retention Test","awards":[],"skills":[],"contact":{}}','synthetic@example.invalid',now(),'synthetic-test','00000000-0000-4000-8000-000000000003');
set local role service_role;
do $$ begin
  if exists(select 1 from jsonb_array_elements(public.image_session_operation('cleanup_claim')) x where x->>'id'='00000000-0000-4000-8000-000000000003') then raise exception 'Cleanup claimed an active submission image'; end if;
end $$;
reset role;
delete from private.submissions where image_asset_id='00000000-0000-4000-8000-000000000003';
set local role service_role;
do $$ declare s jsonb; begin
  begin
    perform public.image_session_operation('get','00000000-0000-4000-8000-000000000003',repeat('a',64)); raise exception 'Expired capability accepted';
  exception when raise_exception then if sqlerrm<>'Image session unavailable' then raise; end if; end;
  select x into s from jsonb_array_elements(public.image_session_operation('cleanup_claim')) x where x->>'id'='00000000-0000-4000-8000-000000000003';
  if s is null then raise exception 'Cleanup missed expired session'; end if;
  if exists(select 1 from jsonb_array_elements(public.image_session_operation('cleanup_claim')) x where x->>'id'='00000000-0000-4000-8000-000000000003') then raise exception 'Cleanup lease not exclusive'; end if;
  perform public.image_session_operation('cleanup_done','00000000-0000-4000-8000-000000000003',null,jsonb_build_object('lease',s->>'lease_id'));
end $$;
reset role;
do $$ begin
  if not exists(select 1 from private.image_assets where id='00000000-0000-4000-8000-000000000003' and processing_state='deleted') then raise exception 'Asset cleanup metadata failed'; end if;
end $$;
rollback;
