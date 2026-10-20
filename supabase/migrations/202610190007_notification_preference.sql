begin;

-- Derive administrator mail preference from the private saved submission,
-- never from caller-supplied mail context. Keep public profiles unchanged.
create function private.add_notification_preference() returns trigger
language plpgsql security definer set search_path = '' as $$
declare opted_in boolean;
begin
  if new.kind = 'administrator' then
    select upgrade_notifications into strict opted_in
      from private.submissions where id = new.submission_id;
    new.payload := new.payload || jsonb_build_object('upgradeNotifications', opted_in);
  end if;
  return new;
end $$;
revoke all on function private.add_notification_preference() from public, anon, authenticated, service_role;
create trigger notification_preference before insert on private.notification_jobs
for each row execute function private.add_notification_preference();

-- Existing unsent jobs can pick up the preference without resending sent mail.
update private.notification_jobs j
set payload = j.payload || jsonb_build_object('upgradeNotifications', s.upgrade_notifications)
from private.submissions s
where s.id = j.submission_id and j.kind = 'administrator' and j.state = 'pending';

commit;
