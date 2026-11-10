begin;
set local lock_timeout='5s';
lock table public.cards,public.user_cards in share row exclusive mode;

-- Normal and Shiny LR copies are distinct collectible variants.
create table public.first_lr_copies (
  card_id uuid not null references public.cards(id) on delete cascade,
  is_shiny boolean not null,
  card_instance_id uuid not null unique,
  evolved_instance_id uuid unique,
  source text not null check(source in ('legacy','mint')),
  recorded_at timestamptz not null default clock_timestamp(),
  primary key(card_id,is_shiny)
);
alter table public.first_lr_copies enable row level security;
revoke all on public.first_lr_copies from public,anon,authenticated,service_role;

insert into public.first_lr_copies(card_id,is_shiny,card_instance_id,source)
select distinct on (u.card_id,u.is_shiny) u.card_id,u.is_shiny,u.id,'legacy'
from public.user_cards u join public.cards c on c.id=u.card_id
left join public.regular_pack_opening_cards origin on origin.card_instance_id=u.id
left join public.regular_pack_openings opening on opening.id=origin.pack_opening_id
where c.rarete_base='LR' and not u.is_evolved
order by u.card_id,u.is_shiny,coalesce(opening.opened_at,u.date_obtention),u.id;

create function public.capture_first_lr_copy() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if tg_table_name='cards' then
    insert into public.first_lr_copies(card_id,is_shiny,card_instance_id,source)
      select distinct on (u.is_shiny) new.id,u.is_shiny,u.id,'legacy' from public.user_cards u
      left join public.regular_pack_opening_cards origin on origin.card_instance_id=u.id
      left join public.regular_pack_openings opening on opening.id=origin.pack_opening_id
      where u.card_id=new.id and not u.is_evolved
      order by u.is_shiny,coalesce(opening.opened_at,u.date_obtention),u.id
      on conflict(card_id,is_shiny) do nothing;
  elsif not new.is_evolved and exists(select 1 from public.cards c where c.id=new.card_id and c.rarete_base='LR') then
    insert into public.first_lr_copies(card_id,is_shiny,card_instance_id,source)
      values(new.card_id,new.is_shiny,new.id,'mint') on conflict(card_id,is_shiny) do nothing;
  end if;
  return new;
end; $$;
revoke all on function public.capture_first_lr_copy() from public,anon,authenticated,service_role;
create trigger user_cards_capture_first_lr_copy after insert on public.user_cards
  for each row execute function public.capture_first_lr_copy();
create trigger cards_capture_first_lr_copy after update of rarete_base on public.cards
  for each row when(new.rarete_base='LR' and old.rarete_base is distinct from new.rarete_base)
  execute function public.capture_first_lr_copy();

create function public.get_first_lr_copy_badges(p_instance_ids uuid[]) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare player uuid:=auth.uid();
begin
  perform public.assert_player_not_banned();
  if player is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_instance_ids is null or cardinality(p_instance_ids)>500
    or (cardinality(p_instance_ids)>0 and (array_ndims(p_instance_ids)<>1 or array_lower(p_instance_ids,1)<>1)) then
    raise exception 'INVALID_CARD_INSTANCE_IDS';
  end if;
  if array_position(p_instance_ids,null) is not null then raise exception 'INVALID_CARD_INSTANCE_IDS'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('instanceId',copy.id,'source',copy.source)
    order by copy.id),'[]'::jsonb) from (
      select card_instance_id id,source from public.first_lr_copies where card_instance_id=any(p_instance_ids)
      union all
      select evolved_instance_id id,source from public.first_lr_copies where evolved_instance_id=any(p_instance_ids)
    ) copy);
end; $$;
revoke all on function public.get_first_lr_copy_badges(uuid[]) from public,anon,authenticated,service_role;
grant execute on function public.get_first_lr_copy_badges(uuid[]) to authenticated;

notify pgrst,'reload schema';
commit;
