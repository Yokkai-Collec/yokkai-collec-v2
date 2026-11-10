begin;
set local lock_timeout='5s';
-- Enrich the existing visibility-checked activity projection only. Never expose
-- counterparties or private pack/referral records to profile viewers.
do $patch$
declare original text; marker text; replacement text;
begin
  original := replace(pg_get_functiondef('public.get_profile_details(text)'::regprocedure),chr(13),'');
  marker := '''kind'', ''obtained'', ''at'', uc.date_obtention,';
  replacement := $source$'kind', 'obtained', 'at', uc.date_obtention,
    'acquisitionSource', case
      when exists (
        select 1 from public.trade_offers trade
        where trade.status='accepted'
          and trade.updated_at between uc.date_obtention - interval '5 minutes' and uc.date_obtention + interval '5 minutes'
          and ((trade.to_user=target and uc.id=any(trade.offered_card_ids))
            or (trade.from_user=target and uc.id=any(trade.requested_card_ids)))
      ) or exists (
        select 1 from public.regular_pack_card_transfers transfer
        where transfer.card_instance_id=uc.id and transfer.to_user_id=target
          and transfer.transfer_type='trade'
          and transfer.occurred_at between uc.date_obtention - interval '5 minutes' and uc.date_obtention + interval '5 minutes'
      ) then 'trade'
      when exists (
        select 1 from public.regular_pack_opening_cards drawn
        where drawn.card_instance_id=uc.id and drawn.original_owner_id=target
          and drawn.recorded_at=uc.date_obtention
      ) or exists (
        select 1 from public.decision_packs pack
        join public.decision_pack_choices choice on choice.id=pack.kept_choice_id and choice.pack_id=pack.id
        where pack.user_id=target and pack.status='claimed'
          and pack.claimed_at=uc.date_obtention and choice.card_id=uc.card_id
      ) then 'pack'
      else 'unknown' end,$source$;
  if (length(original)-length(replace(original,marker,''))) / length(marker) <> 1 then
    raise exception 'PROFILE_RECENT_SOURCE_PATCH_MISMATCH';
  end if;
  execute replace(original,marker,replacement);
end $patch$;
notify pgrst,'reload schema';
commit;
