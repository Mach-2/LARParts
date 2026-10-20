begin;
do $$
declare data jsonb; receipt jsonb; asset uuid; result text; count_before bigint;
begin
  data:=jsonb_build_object('id','synthetic-legacy-sql','checksum',repeat('a',64),'sourceLabel','synthetic',
    'profile',jsonb_build_object('displayName','Synthetic legacy SQL','awards','[]'::jsonb,'skills','[]'::jsonb,'contact','{}'::jsonb),
    'photoOutcome','none','photoFailure',null,'asset',null);
  receipt:=private.legacy_profile_prepare(data);
  if receipt->>'state'<>'prepared' then raise exception 'Receipt not prepared'; end if;
  if exists(select 1 from public.artist_profiles where id='synthetic-legacy-sql') then raise exception 'Prepare published data'; end if;
  result:=private.legacy_profile_commit('synthetic-legacy-sql',repeat('a',64),null);
  if result<>'completed' then raise exception 'Import failed'; end if;
  select count(*) into count_before from private.profile_audit where artist_id='synthetic-legacy-sql';
  perform private.legacy_profile_commit('synthetic-legacy-sql',repeat('a',64),null);
  if (select count(*) from private.profile_audit where artist_id='synthetic-legacy-sql')<>count_before then raise exception 'Retry created audit revision'; end if;
  perform private.admin_change_profile('synthetic-legacy-sql',1,
    jsonb_build_object('displayName','Synthetic edited SQL','awards','[]'::jsonb,'skills','[]'::jsonb,'contact','{}'::jsonb),
    'unpublished',null,'synthetic-sql','Prove import preserves later edits');
  perform private.legacy_profile_prepare(data);
  perform private.legacy_profile_commit('synthetic-legacy-sql',repeat('a',64),null);
  if not exists(select 1 from public.artist_profiles where id='synthetic-legacy-sql' and revision=2 and status='unpublished' and profile->>'displayName'='Synthetic edited SQL') then raise exception 'Later edit overwritten'; end if;
  begin
    perform private.legacy_profile_commit('synthetic-legacy-sql',repeat('b',64),null);
    raise exception 'Changed checksum accepted';
  exception when raise_exception then if sqlerrm='Changed checksum accepted' then raise; end if; end;
  begin
    perform private.legacy_profile_abandon('synthetic-legacy-sql');raise exception 'Completed import abandoned';
  exception when raise_exception then if sqlerrm='Completed import abandoned' then raise; end if; end;
  -- A normalized identity collision must not overwrite or create a phantom audit.
  data:=jsonb_set(jsonb_set(data,'{id}','"synthetic-legacy-conflict"'),'{profile,displayName}','"Synthetic edited SQL"');
  perform private.legacy_profile_prepare(data);
  result:=private.legacy_profile_commit('synthetic-legacy-conflict',repeat('a',64),null);
  if result<>'conflict' or exists(select 1 from private.profile_audit where artist_id='synthetic-legacy-conflict') then raise exception 'Conflict mutated public data/audit'; end if;
  perform private.legacy_profile_abandon('synthetic-legacy-conflict');
  if private.legacy_profile_commit('synthetic-legacy-conflict',repeat('a',64),null)<>'abandoned' then raise exception 'Abandoned import resumed'; end if;
  -- Asset claims persist separately, require a digest and cannot outlive abandonment.
  data:=jsonb_set(jsonb_set(data,'{id}','"synthetic-legacy-image"'),'{profile,displayName}','"Synthetic image SQL"');
  data:=data||jsonb_build_object('photoOutcome','copied','asset',jsonb_build_object('bucket','synthetic-published','byteSize',123,'width',10,'height',10,'sha256',repeat('c',64)));
  receipt:=private.legacy_profile_prepare(data);asset:=(receipt->>'asset_id')::uuid;
  if not exists(select 1 from private.image_assets where id=asset and processing_state='pending') then raise exception 'Image reservation missing'; end if;
  begin
    perform private.legacy_profile_commit('synthetic-legacy-image',repeat('a',64),repeat('d',64));raise exception 'Wrong image digest accepted';
  exception when raise_exception then if sqlerrm='Wrong image digest accepted' then raise; end if; end;
  perform private.legacy_profile_abandon('synthetic-legacy-image');
  if private.legacy_profile_commit('synthetic-legacy-image',repeat('a',64),repeat('c',64))<>'abandoned' then raise exception 'Abandoned asset published'; end if;
  -- SQL-only migration controls and historical records stay out of API roles.
  if has_table_privilege('anon','private.historical_submissions','select') or
    has_table_privilege('authenticated','private.legacy_profile_imports','select') or
    has_function_privilege('service_role','private.legacy_profile_prepare(jsonb)','execute') then raise exception 'Import privileges leaked'; end if;
end $$;
rollback;
