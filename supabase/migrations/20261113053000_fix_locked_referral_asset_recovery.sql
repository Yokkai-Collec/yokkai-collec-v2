begin;
set local lock_timeout='5s';

-- A player lock protects against ordinary transfers. The recovery already
-- proves ownership and reward provenance and excludes active reservations.
do $locked_cards$
declare definition text; updated text;
begin
  definition:=pg_get_functiondef('public.recover_anticheat_referral_sponsor_assets(uuid,uuid)'::regprocedure);
  updated:=replace(definition,
    '    perform 1 from public.user_cards c where c.id=item.card_instance_id and c.user_id=p_referrer for update;',
    '    select to_jsonb(c) into snapshot from public.user_cards c
    where c.id=item.card_instance_id and c.user_id=p_referrer for update;');
  if updated=definition then raise exception 'UNEXPECTED_REFERRAL_CARD_LOCK'; end if;
  definition:=updated;
  updated:=replace(definition,
    '      delete from public.user_cards c where c.id=item.card_instance_id and c.user_id=p_referrer
        returning to_jsonb(c) into snapshot;',
    '      update public.user_cards c set is_locked=false
        where c.id=item.card_instance_id and c.user_id=p_referrer and c.is_locked;
      delete from public.user_cards c where c.id=item.card_instance_id and c.user_id=p_referrer;');
  if updated=definition then raise exception 'UNEXPECTED_REFERRAL_CARD_DELETE'; end if;
  execute updated;
end
$locked_cards$;

update public.anticheat_referral_asset_queue
  set next_check_at=least(next_check_at,clock_timestamp());

commit;
