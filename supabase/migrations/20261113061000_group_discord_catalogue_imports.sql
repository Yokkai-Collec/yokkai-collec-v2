begin;
set local lock_timeout='5s';

create table public.catalogue_discord_imports (
  id uuid primary key,
  updated_at timestamptz not null default clock_timestamp(),
  finished_at timestamptz,
  summary jsonb
);
alter table public.catalogue_discord_imports enable row level security;
revoke all on public.catalogue_discord_imports from public,anon,authenticated,service_role;
alter table public.card_rarity_discord_outbox
  alter column card_id drop not null,
  alter column old_rarity drop not null,
  alter column new_rarity drop not null,
  drop constraint card_rarity_discord_outbox_check,
  drop constraint card_rarity_discord_outbox_status_check,
  add column event_kind text not null default 'RARITY' check(event_kind in('RARITY','ADDITION','IMPORT')),
  add column import_id uuid references public.catalogue_discord_imports(id),
  add column license text,
  add check(status in('COLLECTING','PENDING','SENT','FAILED')),
  add check(event_kind<>'RARITY' or (old_rarity is not null and new_rarity is not null and old_rarity<>new_rarity));

create or replace function public.queue_card_rarity_announcement()
returns trigger language plpgsql security definer set search_path='' as $$
declare message jsonb; event_id bigint; stamp timestamptz:=clock_timestamp();
  batch uuid:=nullif(current_setting('yokkai.catalogue_discord_import',true),'')::uuid;
  previous_rarity public.card_rarity; kind text; licence text;
begin
  if not exists(select 1 from public.card_rarity_discord_config where id and enabled) then return new; end if;
  if tg_op='INSERT' then kind:='ADDITION'; else kind:='RARITY'; previous_rarity:=old.rarete_base; end if;
  licence:=coalesce(nullif(new.franchise,''),new.categorie);
  message:=jsonb_build_object(
    'title',case kind when 'ADDITION' then 'Nouvelle carte ajoutée' else 'Rareté mise à jour' end,
    'url','https://yokkai-collec.com/catalog',
    'color',case new.rarete_base when 'LR' then 16766779 when 'SSR' then 16731048 when 'SR' then 12747263 else 10142942 end,
    'fields',jsonb_build_array(
      jsonb_build_object('name','Carte','value',left(new.nom,500),'inline',false),
      jsonb_build_object('name','Licence','value',left(licence,500),'inline',false)
    )||case when kind='RARITY' then jsonb_build_array(
      jsonb_build_object('name','Ancienne rareté','value',previous_rarity::text,'inline',true),
      jsonb_build_object('name','Nouvelle rareté','value',new.rarete_base::text,'inline',true)
    ) else jsonb_build_array(jsonb_build_object('name','Rareté','value',new.rarete_base::text,'inline',true)) end,
    'timestamp',stamp
  );
  if new.image_url~'^https://' and length(new.image_url)<=2048 then
    message:=message||jsonb_build_object('thumbnail',jsonb_build_object('url',new.image_url));
  end if;
  insert into public.card_rarity_discord_outbox(card_id,old_rarity,new_rarity,payload,created_at,event_kind,import_id,license,status)
    values(new.id,previous_rarity,new.rarete_base,'{}',stamp,kind,batch,licence,
      case when batch is null then 'PENDING' else 'COLLECTING' end) returning id into event_id;
  message:=message||jsonb_build_object('footer',jsonb_build_object('text','Yokkai Collec · Modification n° '||event_id));
  update public.card_rarity_discord_outbox set payload=jsonb_build_object(
    'username','Yokkai · Cartes','allowed_mentions',jsonb_build_object('parse','[]'::jsonb),'embeds',jsonb_build_array(message)
  ) where id=event_id;
  return new;
end;
$$;
create trigger queue_card_addition_announcement after insert on public.cards for each row execute function public.queue_card_rarity_announcement();

create function public.finish_catalogue_discord_import(p_import_id uuid)
returns integer language plpgsql security definer set search_path='' as $$
declare batch public.catalogue_discord_imports%rowtype; count_events integer; result integer:=0;
  summary_data jsonb; details text; added bigint; changed bigint;
begin
  perform public.assert_player_not_banned();
  if not (current_setting('role',true)='service_role' or (current_setting('role',true)='none' and session_user in('postgres','supabase_admin')) or exists(select 1 from public.admin_users where user_id=auth.uid())) then raise exception 'ADMIN_REQUIRED'; end if;
  select * into batch from public.catalogue_discord_imports where id=p_import_id for update;
  if not found or batch.finished_at is not null then return 0; end if;
  select count(*) into count_events from public.card_rarity_discord_outbox where import_id=p_import_id and status='COLLECTING';
  if count_events>5 then
    select jsonb_agg(to_jsonb(licenses) order by license),
      string_agg(format('• %s — %s %s%s',license,licenses.added,
        case when licenses.added=1 then 'carte ajoutée' else 'cartes ajoutées' end,
        case when licenses.changed>0 then format(' · %s %s',licenses.changed,
          case when licenses.changed=1 then 'rareté modifiée' else 'raretés modifiées' end) else '' end),E'\n' order by license),
      sum(licenses.added),sum(licenses.changed) into summary_data,details,added,changed
    from (select license,count(*) filter(where event_kind='ADDITION') as added,
      count(*) filter(where event_kind='RARITY') as changed from public.card_rarity_discord_outbox
      where import_id=p_import_id and status='COLLECTING' group by license) licenses;
    update public.catalogue_discord_imports set summary=summary_data where id=p_import_id;
    -- Keep a single Discord message even if unusually long license names exceed
    -- Discord's embed limit. The complete public catalogue-only list stays linked.
    if length(details)>3900 then
      details:='Import terminé. [Liste complète des licences et des quantités](https://yokkai-collec.com/api/catalogue-imports/'||p_import_id||').';
    end if;
    insert into public.card_rarity_discord_outbox(event_kind,import_id,payload)
      values('IMPORT',p_import_id,jsonb_build_object('username','Yokkai · Cartes',
        'allowed_mentions',jsonb_build_object('parse','[]'::jsonb),
        'embeds',jsonb_build_array(jsonb_build_object(
          'title',case when added>0 then 'Ajouts au catalogue' else 'Raretés mises à jour' end,
          'description',details,'color',16766779,
          'fields',jsonb_build_array(
            jsonb_build_object('name','Licences','value',jsonb_array_length(summary_data)::text,'inline',true),
            jsonb_build_object('name','Cartes ajoutées','value',added::text,'inline',true))
            ||case when changed>0 then jsonb_build_array(jsonb_build_object('name','Raretés modifiées','value',changed::text,'inline',true)) else '[]'::jsonb end,
          'url','https://yokkai-collec.com/catalog','timestamp',clock_timestamp()
        ))));
    result:=1;
    delete from public.card_rarity_discord_outbox where import_id=p_import_id and status='COLLECTING';
  else
    update public.card_rarity_discord_outbox set status='PENDING' where import_id=p_import_id and status='COLLECTING';
    get diagnostics result=row_count;
  end if;
  update public.catalogue_discord_imports set finished_at=clock_timestamp() where id=p_import_id;
  return result;
end;
$$;
revoke all on function public.finish_catalogue_discord_import(uuid) from public,anon,authenticated,service_role;
grant execute on function public.finish_catalogue_discord_import(uuid) to authenticated,service_role;

create function public.get_catalogue_import_summary(p_import_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select summary from public.catalogue_discord_imports where id=p_import_id and finished_at is not null
$$;
revoke all on function public.get_catalogue_import_summary(uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_catalogue_import_summary(uuid) to anon,authenticated;

create function public.import_catalogue_cards_announced(p_rows jsonb,p_import_id uuid,p_anilist boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; previous text:=current_setting('yokkai.catalogue_discord_import',true);
begin
  perform public.assert_player_not_banned();
  if not (current_setting('role',true)='service_role' or (current_setting('role',true)='none' and session_user in('postgres','supabase_admin')) or exists(select 1 from public.admin_users where user_id=auth.uid())) then raise exception 'ADMIN_REQUIRED'; end if;
  if p_anilist and current_setting('role',true) not in('service_role','none') then raise exception 'SERVICE_ROLE_REQUIRED'; end if;
  if p_import_id is null or jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows)>200 then raise exception 'INVALID_IMPORT'; end if;
  insert into public.catalogue_discord_imports(id) values(p_import_id) on conflict(id) do nothing;
  perform 1 from public.catalogue_discord_imports where id=p_import_id and finished_at is null for update;
  if not found then raise exception 'IMPORT_ALREADY_FINISHED'; end if;
  update public.catalogue_discord_imports set updated_at=clock_timestamp() where id=p_import_id;
  perform set_config('yokkai.catalogue_discord_import',p_import_id::text,true);
  if p_anilist then
    result:=public.import_anilist_cards(p_rows,p_import_id);
  else
    insert into public.cards(source,source_id,nom,categorie,franchise,franchise_romaji,rarete_base,image_url,favoris_count)
      select source,source_id,nom,categorie,franchise,franchise_romaji,rarete_base,image_url,favoris_count
      from jsonb_populate_recordset(null::public.cards,p_rows)
    on conflict(source,source_id) do update set nom=excluded.nom,categorie=excluded.categorie,
      franchise=excluded.franchise,franchise_romaji=excluded.franchise_romaji,rarete_base=excluded.rarete_base,
      image_url=excluded.image_url,favoris_count=excluded.favoris_count;
    result:='[]'::jsonb;
  end if;
  perform set_config('yokkai.catalogue_discord_import',coalesce(previous,''),true);
  return result;
end;
$$;
revoke all on function public.import_catalogue_cards_announced(jsonb,uuid,boolean) from public,anon,authenticated,service_role;
grant execute on function public.import_catalogue_cards_announced(jsonb,uuid,boolean) to authenticated,service_role;

create function public.update_catalogue_card_announced(p_card_id uuid,p_patch jsonb,p_import_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare previous text:=current_setting('yokkai.catalogue_discord_import',true);
begin
  perform public.assert_player_not_banned();
  if not (current_setting('role',true)='service_role' or (current_setting('role',true)='none' and session_user in('postgres','supabase_admin')) or exists(select 1 from public.admin_users where user_id=auth.uid())) then raise exception 'ADMIN_REQUIRED'; end if;
  if p_import_id is null then raise exception 'INVALID_IMPORT'; end if;
  insert into public.catalogue_discord_imports(id) values(p_import_id) on conflict(id) do nothing;
  perform 1 from public.catalogue_discord_imports where id=p_import_id and finished_at is null for update;
  if not found then raise exception 'IMPORT_ALREADY_FINISHED'; end if;
  update public.catalogue_discord_imports set updated_at=clock_timestamp() where id=p_import_id;
  perform set_config('yokkai.catalogue_discord_import',p_import_id::text,true);
  update public.cards set rarete_base=(p_patch->>'rarete_base')::public.card_rarity,
    image_url=p_patch->>'image_url',franchise=p_patch->>'franchise' where id=p_card_id;
  perform set_config('yokkai.catalogue_discord_import',coalesce(previous,''),true);
end;
$$;
revoke all on function public.update_catalogue_card_announced(uuid,jsonb,uuid) from public,anon,authenticated,service_role;
grant execute on function public.update_catalogue_card_announced(uuid,jsonb,uuid) to authenticated,service_role;

-- An interrupted multi-request import must still produce a bounded summary of
-- its committed changes. Thirty quiet minutes is a fallback, not a batch boundary.
do $dispatch$
declare definition text; updated text;
begin
  definition:=pg_get_functiondef('public.dispatch_card_rarity_announcements()'::regprocedure);
  updated:=replace(definition,'  select * into config',
    '  perform public.finish_catalogue_discord_import(id) from public.catalogue_discord_imports
      where finished_at is null and updated_at<clock_timestamp()-interval ''30 minutes'';
  select * into config');
  if updated=definition then raise exception 'UNEXPECTED_DISPATCH_BODY'; end if;
  execute updated;
end;
$dispatch$;
commit;
