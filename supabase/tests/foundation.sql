-- Run against TESTING only, after migrations. Every fixture is rolled back.
begin;
set local app.audit_actor = 'synthetic-policy-test';
set local app.audit_reason = 'Step 2 boundary validation';
insert into public.artist_profiles(id,profile,status) values
('step2-test-public','{"displayName":"Step2 Synthetic Public","kingdom":"Testing","awards":[],"skills":[],"contact":{}}','published'),
('step2-test-hidden','{"displayName":"Step2 Synthetic Hidden","awards":[],"skills":[],"contact":{}}','unpublished');
do $$ begin
  begin
    insert into public.artist_profiles(id,profile) values ('step2-duplicate','{"displayName":" step2 synthetic public ","kingdom":" testing ","awards":[],"skills":[],"contact":{}}');
    raise exception 'Duplicate identity accepted';
  exception when unique_violation then null; end;
  begin
    insert into public.artist_profiles(id,profile) values ('step2-private-leak','{"displayName":"Leak","awards":[],"skills":[],"contact":{},"email":"synthetic@example.invalid"}');
    raise exception 'Private profile field accepted';
  exception when check_violation then null; end;
  if (select count(*) from private.profile_audit where artist_id like 'step2-test-%') <> 2 then raise exception 'Missing insert audit'; end if;
end $$;

set local role anon;
do $$ declare t text; op text; begin
  if (select count(*) from public.artist_profiles where id like 'step2-test-%') <> 1 then raise exception 'Published RLS failed'; end if;
  foreach t in array array['image_assets','submissions','verification_tokens','notification_jobs','profile_audit'] loop
    begin
      execute format('select * from private.%I',t);
      raise exception 'Private read allowed';
    exception when insufficient_privilege then null; end;
  end loop;
  foreach op in array array[
    'insert into public.artist_profiles(id,profile) values (''forbidden'',''{}'')',
    'update public.artist_profiles set status = ''unpublished'' where id = ''step2-test-public''',
    'delete from public.artist_profiles where id = ''step2-test-public'''
  ] loop
    begin execute op; raise exception 'Anonymous write allowed';
    exception when insufficient_privilege then null; end;
  end loop;
end $$;
reset role;
set local role authenticated;
do $$ declare op text; begin
  if (select count(*) from public.artist_profiles where id like 'step2-test-%') <> 1 then raise exception 'Authenticated RLS failed'; end if;
  if has_schema_privilege(current_user,'private','usage') or has_table_privilege(current_user,'public.artist_profiles','update') then raise exception 'Authenticated privilege leak'; end if;
  foreach op in array array[
    'insert into public.artist_profiles(id,profile) values (''forbidden'',''{}'')',
    'update public.artist_profiles set status = ''unpublished'' where id = ''step2-test-public''',
    'delete from public.artist_profiles where id = ''step2-test-public'''
  ] loop
    begin execute op; raise exception 'Authenticated write allowed';
    exception when insufficient_privilege then null; end;
  end loop;
end $$;
reset role;

-- New public objects must remain private until deliberately granted.
create table public.step2_future_table(id integer);
create function public.step2_future_function() returns integer language sql as $$ select 1 $$;
do $$ begin
  if has_table_privilege('anon','public.step2_future_table','select') or
     has_table_privilege('authenticated','public.step2_future_table','insert') or
     has_function_privilege('anon','public.step2_future_function()','execute') or
     has_function_privilege('authenticated','public.step2_future_function()','execute') then
    raise exception 'Unsafe default grants';
  end if;
end $$;

select private.admin_change_profile(id,revision,profile,'unpublished',image_asset_id,'synthetic-policy-test','Step 2 boundary validation')
from public.artist_profiles where id='step2-test-public';
do $$ begin
  if not exists (select 1 from private.profile_audit where artist_id='step2-test-public' and before_row->>'status'='published' and after_row->>'status'='unpublished' and actor='synthetic-policy-test' and reason='Step 2 boundary validation') then raise exception 'Unpublish audit missing'; end if;
end $$;
-- Restore public fields/status from history; revision still advances.
select private.admin_restore_profile(p.id,p.revision,a.id,'synthetic-policy-test','Restore synthetic prior state')
from public.artist_profiles p join private.profile_audit a on a.artist_id=p.id
where p.id='step2-test-public' and a.operation='UPDATE';
do $$ begin
  if not exists (select 1 from public.artist_profiles where id='step2-test-public' and status='published' and revision=3) then raise exception 'Restore failed'; end if;
  begin
    perform private.admin_change_profile('step2-test-public',1,'{}','published',null,'synthetic-policy-test','Stale correction');
    raise exception 'Stale correction allowed';
  exception when raise_exception then
    if sqlerrm <> 'Profile missing or revision conflict' then raise; end if;
  end;
end $$;
set local app.audit_reason = '';
do $$ begin
  begin
    update public.artist_profiles set status='unpublished' where id='step2-test-public';
    raise exception 'Missing reason accepted';
  exception when raise_exception then
    if sqlerrm <> 'Audit actor and reason required' then raise; end if;
  end;
end $$;
rollback;
