begin;
set local lock_timeout='5s';

create function public.anticheat_discord_profile(p_user uuid)
returns text language sql stable set search_path='' as $$
  select case when p_user is null then 'Compte indisponible' else format('[%s](https://yokkai-collec.com/profile/%s)',
    coalesce(nullif(regexp_replace(left(btrim(regexp_replace(
      (select pseudo from public.user_profiles where user_id=p_user),'[[:cntrl:]]',' ','g')),28),
      '([][()'||repeat(chr(92),2)||chr(96)||'*_~|<>])',repeat(chr(92),3)||'1','g'),''),
      'Compte '||left(p_user::text,8)),
    p_user) end
$$;
revoke all on function public.anticheat_discord_profile(uuid) from public,anon,authenticated,service_role;

create function public.format_anticheat_discord_alert()
returns trigger language plpgsql security definer set search_path='' as $$
declare
  e public.anticheat_events%rowtype;
  c public.anticheat_network_clusters%rowtype;
  q public.anticheat_quarantines%rowtype;
  t public.trade_offers%rowtype;
  run public.anticheat_farm_runs%rowtype;
  case_id uuid;
  beneficiary uuid;
  members uuid[];
  accounts text;
  exchanges text;
  referrals text;
  category text;
  subject_title text;
  summary text;
  admin_url text:='https://yokkai-collec.com/admin/security';
  fields jsonb:='[]';
  accent integer:=5793266;
begin
  select * into strict e from public.anticheat_events where id=new.event_id;
  if e.event_type='network_cluster_threshold' then
    select * into c from public.anticheat_network_clusters where id=e.subject_id;
    if not found then return new; end if;
    admin_url:=admin_url||'?cluster='||c.id||'#anticheat-clusters';
    if e.metadata->>'tier'='critical' then
      subject_title:='Réseau partagé · seuil critique';
      accent:=15105570;
    else
      subject_title:='Réseau partagé · groupe à examiner';
    end if;
    summary:=format('%s comptes sur le même réseau, dont %s créés dans les dernières 24 h. Ce signal ouvre une enquête.',
      c.account_count,c.recent_account_count);
    select array_agg(n.user_id order by n.user_id) into members
    from public.anticheat_network_observations n
    join auth.users u on u.id=n.user_id
    cross join public.anticheat_cluster_settings s
    where n.network_identity=c.network_identity and n.last_seen_at>=now()-make_interval(days=>s.observation_days);
    select string_agg(public.anticheat_discord_profile(a.user_id),' · ' order by a.position) into accounts
    from unnest(members) with ordinality as a(user_id,position) where a.position<=7;
    if cardinality(members)>7 then
      accounts:=accounts||format(' · +%s dans le dossier',cardinality(members)-7);
    end if;
    fields:=jsonb_build_array(jsonb_build_object('name','Comptes du groupe','value',coalesce(accounts,'Voir le dossier.')));
    -- The investigator counts one-way accepted offers. When the proposer
    -- requests a gift, the actual assets travel from the recipient to them.
    if c.one_way_trades>0 then
      with flows as (
        select case when empty_offer then o.to_user else o.from_user end as sender,
          case when empty_offer then o.from_user else o.to_user end as recipient,
          case when empty_offer then cardinality(o.requested_card_ids) else cardinality(o.offered_card_ids) end as cards,
          case when empty_offer then o.requested_karas else o.offered_karas end as karas
        from public.trade_offers o
        cross join lateral (select cardinality(o.offered_card_ids)=0 and o.offered_karas=0 as empty_offer,
          cardinality(o.requested_card_ids)=0 and o.requested_karas=0 as empty_request) sides
        where o.from_user=any(members) and o.to_user=any(members)
          and o.status='accepted' and o.created_at>=now()-interval '30 days'
          and empty_offer<>empty_request
      ), busiest as (
        select sender,recipient,count(*) n,sum(cards) cards,sum(karas) karas
        from flows group by sender,recipient order by n desc,sender,recipient limit 3
      )
      select string_agg(format('%s → %s · %s éch. · %s cartes · %s Karas',
          public.anticheat_discord_profile(sender),public.anticheat_discord_profile(recipient),n,cards,karas),
          E'\n' order by n desc,sender,recipient) into exchanges from busiest;
    end if;
    if c.referral_count>0 then
      select string_agg(format('%s → %s · %s',
          public.anticheat_discord_profile(r.referrer_id),public.anticheat_discord_profile(r.referred_id),
          case when r.rewarded_at is null then 'récompense non versée' else 'récompense versée' end),
          E'\n' order by r.created_at desc,r.id) into referrals
      from (select r.* from public.referrals r where r.referrer_id=any(members) and r.referred_id=any(members)
        and r.created_at>=now()-interval '30 days' order by r.created_at desc,r.id limit 3) r;
    end if;
    fields:=fields||jsonb_build_array(
      jsonb_build_object('name',format('Échanges à sens unique (%s sur 30 j) · donneur → receveur',c.one_way_trades),
        'value',coalesce(exchanges,'Aucun échange à sens unique relevé.')),
      jsonb_build_object('name',format('Parrainages (%s sur 30 j) · parrain → filleul',c.referral_count),
        'value',coalesce(referrals,'Aucun parrainage interne relevé.')));
  elsif e.event_type='anticheat_operational_alert' then
    category:=e.metadata->>'category';
    accent:=case when category in('FARM_BAN','FARM_SUSPENSION','CRITICAL_QUARANTINE') then 15158332 else 15105570 end;
    if category='FARM_CONFIRMED' then
      select * into run from public.anticheat_farm_runs r where r.mode='APPLY'
        and r.snapshot->>'beneficiary'=e.actor_user_id::text
        and md5((r.snapshot->>'beneficiary')||':'||coalesce((r.snapshot->'secondaries')::text,''))::uuid=e.subject_id
        order by r.created_at desc limit 1;
      subject_title:='Ferme de comptes confirmée';
      summary:='La politique automatique a confirmé le dossier. Les sanctions appliquées font l’objet de leurs propres alertes.';
      fields:=jsonb_build_array(jsonb_build_object('name','Bénéficiaire','value',public.anticheat_discord_profile(e.actor_user_id)));
      if run.cluster_id is not null then
        admin_url:=admin_url||'?cluster='||run.cluster_id||'#anticheat-clusters';
        select string_agg(public.anticheat_discord_profile(a.user_id::uuid),' · ' order by a.position) into accounts
        from jsonb_array_elements_text(run.snapshot->'secondaries') with ordinality as a(user_id,position)
        where a.position<=7;
        if accounts is not null then
          fields:=fields||jsonb_build_array(jsonb_build_object('name',
            format('Comptes secondaires impliqués (%s)',jsonb_array_length(run.snapshot->'secondaries')),'value',accounts));
        end if;
      end if;
    elsif category in('FARM_BAN','FARM_WARNING','FARM_SUSPENSION') then
      subject_title:=case category when 'FARM_BAN' then 'Bannissement définitif appliqué'
        when 'FARM_WARNING' then 'Avertissement appliqué' else 'Suspension de 48 h appliquée' end;
      summary:=case category when 'FARM_BAN' then 'Compte secondaire confirmé dans un dossier de fraude au parrainage.'
        when 'FARM_WARNING' then 'Participation du bénéficiaire établie dans un dossier de fraude au parrainage.'
        else 'Trois avertissements actifs sur des dossiers distincts.' end;
      fields:=jsonb_build_array(jsonb_build_object('name',
        case when category='FARM_BAN' then 'Compte secondaire banni' else 'Bénéficiaire sanctionné' end,
        'value',public.anticheat_discord_profile(e.actor_user_id)));
      admin_url:=admin_url||'?user='||e.actor_user_id;
      select f.cluster_id,f.beneficiary_id into case_id,beneficiary
      from public.account_sanctions s join public.anticheat_farm_evidence f
        on f.cluster_id=(s.metadata->>'cluster')::uuid
      where s.id=e.subject_id;
      if case_id is not null then
        admin_url:='https://yokkai-collec.com/admin/security?cluster='||case_id||'#anticheat-clusters';
      end if;
      if beneficiary is not null and beneficiary<>e.actor_user_id then
        fields:=fields||jsonb_build_array(jsonb_build_object('name','Bénéficiaire du dossier',
          'value',public.anticheat_discord_profile(beneficiary)));
      end if;
    elsif category in('CRITICAL_QUARANTINE','QUARANTINE_JOB_FAILURE') then
      select * into q from public.anticheat_quarantines where id=e.subject_id;
      subject_title:=case when category='CRITICAL_QUARANTINE' then 'Quarantaine critique à examiner' else 'Échec de réévaluation d’une quarantaine' end;
      summary:='Le dossier nécessite une vérification dans la console de sécurité.';
      fields:=jsonb_build_array(
        jsonb_build_object('name','Auteur de l’offre','value',public.anticheat_discord_profile(q.sender_user_id),'inline',true),
        jsonb_build_object('name','Destinataire de l’offre','value',public.anticheat_discord_profile(q.recipient_user_id),'inline',true));
      admin_url:=admin_url||'?quarantine_status=AWAITING_REVIEW#quarantine-'||e.subject_id;
    else
      subject_title:=case category when 'RECOVERY_FAILURE' then 'Échec de récupération d’un actif'
        else 'Échec du traitement automatique d’un dossier' end;
      summary:='Ouvrir la console de sécurité pour vérifier le dossier.';
      fields:=jsonb_build_array(jsonb_build_object('name',case when category='RECOVERY_FAILURE' then 'Admin ayant lancé la récupération'
        else 'Bénéficiaire du dossier' end,'value',public.anticheat_discord_profile(e.actor_user_id)));
      if category='ENFORCEMENT_JOB_FAILURE' then admin_url:=admin_url||'?cluster='||e.subject_id||'#anticheat-clusters'; end if;
    end if;
  else
    subject_title:=case e.event_type
      when 'trade_shared_network_identity' then 'Échange entre comptes d’un réseau partagé'
      when 'trade_created' then 'Offre d’échange signalée'
      when 'trade_accepted' then 'Échange accepté signalé'
      when 'trade_declined' then 'Échange refusé signalé'
      when 'trade_cancelled' then 'Échange annulé signalé'
      when 'referral_network_enforcement' then 'Action appliquée sur des parrainages'
      when 'referral_network_review' then 'Parrainage à examiner'
      when 'referral_rewarded' then 'Récompense de parrainage signalée'
      when 'network_identity_shared' then 'Réseau partagé détecté'
      when 'account_registered' then 'Inscription à examiner'
      when 'auction_created' then 'Mise en vente à examiner'
      when 'auction_bid' then 'Enchère à examiner'
      when 'auction_sold' then 'Vente aux enchères à examiner'
      when 'auction_expired' then 'Enchère expirée à examiner'
      else 'Signalement à examiner' end;
    summary:=format('Événement n° %s dans la console de sécurité.',e.id);
    if e.actor_user_id is not null then admin_url:=admin_url||'?user='||e.actor_user_id; end if;
    if e.event_type like 'trade_%' then
      select * into t from public.trade_offers where id=e.subject_id;
    end if;
    fields:=jsonb_build_array(jsonb_build_object('name',case when t.id is not null then 'Auteur de l’offre'
        when e.event_type in('referral_network_enforcement','referral_network_review') then 'Parrain' else 'Compte à l’origine du signal' end,
        'value',public.anticheat_discord_profile(coalesce(t.from_user,e.actor_user_id)),'inline',true));
    if coalesce(t.to_user,e.counterparty_user_id) is not null then
      fields:=fields||jsonb_build_array(jsonb_build_object('name',case when t.id is not null then 'Destinataire de l’offre'
        else 'Autre compte associé' end,'value',public.anticheat_discord_profile(coalesce(t.to_user,e.counterparty_user_id)),'inline',true));
    end if;
    if t.id is not null then
      fields:=fields||jsonb_build_array(
        jsonb_build_object('name','Auteur → destinataire','value',format('%s cartes · %s Karas',cardinality(t.offered_card_ids),t.offered_karas)),
        jsonb_build_object('name','Destinataire → auteur','value',format('%s cartes · %s Karas',cardinality(t.requested_card_ids),t.requested_karas)));
    elsif e.event_type='referral_network_enforcement' then
      fields:=fields||jsonb_build_array(jsonb_build_object('name','Bilan',
        'value',format('%s comptes filleuls concernés · %s packs inutilisés retirés',
          coalesce(e.metadata->>'referredCount','0'),coalesce(e.metadata->>'unusedReferralPacksRemoved','0'))));
    elsif e.card_count>0 or e.amount>0 then
      fields:=fields||jsonb_build_array(jsonb_build_object('name','Volume enregistré',
        'value',format('%s cartes · %s Karas',e.card_count,e.amount)));
    end if;
  end if;
  new.payload:=jsonb_build_object('allowed_mentions',jsonb_build_object('parse','[]'::jsonb),
    'embeds',jsonb_build_array(jsonb_build_object('title','Yokkai · '||subject_title,'description',summary,'url',admin_url,
      'color',accent,'fields',fields,'timestamp',e.occurred_at)));
  return new;
end;
$$;
revoke all on function public.format_anticheat_discord_alert() from public,anon,authenticated,service_role;
create trigger format_anticheat_discord_alert before insert or update of payload on public.anticheat_discord_outbox
  for each row execute function public.format_anticheat_discord_alert();

commit;
