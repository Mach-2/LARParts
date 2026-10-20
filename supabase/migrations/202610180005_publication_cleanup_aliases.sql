begin;
-- SQL aliases must also differ from the PL/pgSQL asset/token record variables.
-- Keep the deployed migration history intact and preserve restricted RPC grants.
do $repair$
declare definition text;
  orphan_before text := 'public.artist_profiles a where a.image_asset_id=i.asset_id';
  orphan_after text := 'public.artist_profiles published_profile where published_profile.image_asset_id=i.asset_id';
  tokens_before text := $before$private.verification_tokens t join private.submissions mail_submission on mail_submission.id=t.submission_id where t.id=j.token_id and (mail_submission.state<>'pending' or t.revoked_at is not null or t.consumed_at is not null or t.expires_at<=now())$before$;
  tokens_after text := $after$private.verification_tokens verification_record join private.submissions mail_submission on mail_submission.id=verification_record.submission_id where verification_record.id=j.token_id and (mail_submission.state<>'pending' or verification_record.revoked_at is not null or verification_record.consumed_at is not null or verification_record.expires_at<=now())$after$;
begin
  select pg_get_functiondef('public.publication_operation(text,uuid,text,jsonb)'::regprocedure) into definition;
  if strpos(definition,orphan_before)=0 or strpos(definition,tokens_before)=0 then raise exception 'Expected publication cleanup function definition unavailable'; end if;
  execute replace(replace(definition,orphan_before,orphan_after),tokens_before,tokens_after);
end $repair$;
commit;
