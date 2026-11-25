begin;
set local lock_timeout = '3s';

-- A recipient whose deletion has started gets no notification. Without this, the
-- deletion fence on notifications aborted the caller's whole transaction: a card
-- wishlisted by a half-deleted account could no longer be listed at auction.
-- Row triggers fire by name: this one runs before account_deletion_reference_guard.
create function public.skip_deleted_recipient_notification() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists(select 1 from public.account_deletion_log where user_id=new.user_id) then return null; end if;
  return new;
end $$;
revoke all on function public.skip_deleted_recipient_notification() from public,anon,authenticated,service_role;

create trigger account_deletion_recipient_skip before insert on public.notifications
for each row execute function public.skip_deleted_recipient_notification();

commit;
