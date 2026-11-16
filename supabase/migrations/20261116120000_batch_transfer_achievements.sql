-- Large trades must not rescan each recipient's collection once per card.
begin;
set local lock_timeout = '3s';

create or replace function public.on_card_acquired_achievements()
returns trigger language plpgsql security definer set search_path = '' as $$
declare player record;
begin
  for player in
    select n.user_id, count(*) filter(where n.is_evolved)::integer as evolved,
      bool_or(not n.is_evolved) as acquired
    from transferred_cards n join previous_cards o using(id)
    where n.user_id is distinct from o.user_id
    group by n.user_id order by n.user_id
  loop
    perform public.ensure_achievement_stats(player.user_id);
    if player.evolved > 0 then
      update public.user_achievement_stats
        set ssr_evolved_to_lr=ssr_evolved_to_lr+player.evolved where user_id=player.user_id;
      perform public.complete_achievements(player.user_id,array['ssr_evolved_to_lr']);
    end if;
    if player.acquired then
      perform public.complete_achievements(player.user_id,array[
        'unique_cards_collected','first_lr_card','shiny_cards_collected','cards_collected_category_percent'
      ]);
    end if;
  end loop;
  return null;
end;
$$;

-- Transition tables require UPDATE without a column list. The function filters
-- unchanged owners, so locks, folders and image edits never evaluate achievements.
drop trigger user_cards_acquired_achievements on public.user_cards;
create trigger user_cards_acquired_achievements after update on public.user_cards
  referencing old table as previous_cards new table as transferred_cards
  for each statement execute function public.on_card_acquired_achievements();

commit;
