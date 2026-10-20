begin;
-- Preserve the already-applied 003 migration and repair only its two mail-query
-- aliases. PL/pgSQL's submission record variable is named s, so SQL aliases must
-- not share that name. pg_get_functiondef retains SECURITY DEFINER/search_path;
-- CREATE OR REPLACE also preserves this function's existing restricted grants.
do $$
declare definition text;
  claim_before text := 'private.submissions s on s.id=v.submission_id where v.id=j.token_id and s.state=';
  claim_after text := 'private.submissions mail_submission on mail_submission.id=v.submission_id where v.id=j.token_id and mail_submission.state=';
  maintenance_before text := 'private.submissions s on s.id=t.submission_id where t.id=j.token_id and (s.state<>';
  maintenance_after text := 'private.submissions mail_submission on mail_submission.id=t.submission_id where t.id=j.token_id and (mail_submission.state<>';
begin
  select pg_get_functiondef('public.publication_operation(text,uuid,text,jsonb)'::regprocedure) into definition;
  if strpos(definition,claim_before)=0 or strpos(definition,maintenance_before)=0 then raise exception 'Expected publication mail function definition unavailable'; end if;
  definition := replace(replace(definition,claim_before,claim_after),maintenance_before,maintenance_after);
  execute definition;
end $$;
commit;
