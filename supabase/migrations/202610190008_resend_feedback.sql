begin;
-- Preserve existing migrations and restricted grants. Return resend feedback
-- only after the existing capability check; rejected attempts cannot rotate tokens.
do $$
declare definition text;
  before_text text := $old$if s.state<>'pending' or s.expires_at<=now() or s.last_confirmation_at>now()-interval '5 minutes' or s.resend_count>=3 or s.publication_deadline<now()+interval '24 hours' then raise exception 'Resend unavailable'; end if;$old$;
  after_text text := $new$if s.state<>'pending' or s.expires_at<=now() or s.publication_deadline<now()+interval '24 hours' then return jsonb_build_object('state','resend_unavailable'); end if;
    if s.resend_count>=3 then return jsonb_build_object('state','resend_limit'); end if;
    if s.last_confirmation_at>now()-interval '5 minutes' then
      return jsonb_build_object('state','resend_cooldown','retryAfter',greatest(1,ceil(extract(epoch from s.last_confirmation_at+interval '5 minutes'-now()))::integer));
    end if;$new$;
  rate_before text := $old$return jsonb_build_object('allowed',n <= (p_data->>'limit')::integer);$old$;
  rate_after text := $new$return jsonb_build_object('allowed',n <= (p_data->>'limit')::integer,'retryAfter',greatest(1,ceil(extract(epoch from date_trunc('hour',now())+interval '1 hour'-now()))::integer));$new$;
begin
  select pg_get_functiondef('public.publication_operation(text,uuid,text,jsonb)'::regprocedure) into definition;
  if strpos(definition,before_text)=0 or strpos(definition,rate_before)=0 then raise exception 'Expected publication feedback definition unavailable'; end if;
  execute replace(replace(definition,before_text,after_text),rate_before,rate_after);
end $$;
commit;
