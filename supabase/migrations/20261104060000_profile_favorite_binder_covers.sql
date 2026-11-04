begin;
set local lock_timeout='5s';

-- Enrich the already-authorized favorite albums only. No owner/account data,
-- privilege, visibility predicate or completion count changes.
do $covers$ declare target regprocedure; original text; changed text; marker text; replacement text;begin
  target:='public.get_profile_details(text)'::regprocedure;
  original:=replace(pg_get_functiondef(target),chr(13),'');
  marker:='''license'', f.license, ''total'', count(distinct c.id),';
  replacement:=$legacy$'license', f.license, 'image', (
    select cover.image_url from public.card_franchises cover_link
    join public.cards cover on cover.id=cover_link.card_id
    where cover_link.franchise=f.license and nullif(btrim(cover.image_url),'') is not null
    order by case cover.rarete_base when 'LR' then 0 when 'SSR' then 1 when 'SR' then 2 when 'R' then 3 else 4 end,cover.id
    limit 1), 'total', count(distinct c.id),$legacy$;
  if (length(original)-length(replace(original,marker,''))) / length(marker) <> 1 then
    raise exception 'PROFILE_FAVORITE_COVER_PATCH_MISMATCH: %',target;
  end if;
  changed:=replace(original,marker,replacement);execute changed;

  target:='public.get_profile_details_with_binders(text)'::regprocedure;
  original:=replace(pg_get_functiondef(target),chr(13),'');
  marker:='''origin'',origin,''total'',total,';
  replacement:=$stable$'origin',origin,'image',(
    select cover.image_url from public.catalogue_binder_links cover_link
    join public.cards cover on cover.id=cover_link.card_id
    where cover_link.binder_key=progress.binder_key and nullif(btrim(cover.image_url),'') is not null
    order by case cover.rarete_base when 'LR' then 0 when 'SSR' then 1 when 'SR' then 2 when 'R' then 3 else 4 end,cover.id
    limit 1),'total',total,$stable$;
  if (length(original)-length(replace(original,marker,''))) / length(marker) <> 1 then
    raise exception 'PROFILE_FAVORITE_COVER_PATCH_MISMATCH: %',target;
  end if;
  changed:=replace(original,marker,replacement);execute changed;
end $covers$;
notify pgrst,'reload schema';
commit;
