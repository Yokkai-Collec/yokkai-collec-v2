begin;
set local lock_timeout='5s';

-- V2 is feature-flagged. Until discord_alerts_v2 is explicitly enabled, the
-- deployed routing keeps its existing behavior. This makes the migration safe
-- to install before the operational alert policy is approved.
create table public.anticheat_discord_dead_letters (
  event_id bigint primary key references public.anticheat_events(id) on delete restrict,
  payload jsonb not null,
  queued_at timestamptz not null,
  failed_at timestamptz not null default clock_timestamp(),
  attempts integer not null check(attempts>=12),
  last_error text,
  resolution text,
  resolved_at timestamptz,
  resolved_by uuid,
  check((resolved_at is null)=(resolution is null))
);
alter table public.anticheat_discord_dead_letters enable row level security;
revoke all on public.anticheat_discord_dead_letters from public,anon,authenticated,service_role;
create index anticheat_discord_dead_letters_open_idx
  on public.anticheat_discord_dead_letters(failed_at desc)
  where resolved_at is null;

create function public.anticheat_discord_event_allowed(p_event_id bigint)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare event_row public.anticheat_events%rowtype; total_risk integer;
begin
  select * into event_row from public.anticheat_events where id=p_event_id;
  if not found then return false; end if;
  if not public.anticheat_runtime_flag_enabled('discord_alerts_v2') then
    return exists(select 1 from public.anticheat_event_subjects where event_id=p_event_id and risk_points>0);
  end if;
  select coalesce(sum(risk_points),0)::integer into total_risk
    from public.anticheat_event_subjects where event_id=p_event_id;
  if total_risk>=80 then return true; end if;
  if event_row.event_type in (
    'referral_network_enforcement',
    'automatic_trade_sanction',
    'asset_recovery_failed',
    'sanction_circumvention'
  ) then return true; end if;
  -- The V2 policy intentionally excludes a shared-network trade unless the
  -- event itself has corroborated browser evidence. The existing master event
  -- has no such evidence and therefore stays in the private ledger only.
  return event_row.event_type in ('trade_shared_identity','trade_shared_network_identity')
    and coalesce((event_row.metadata->>'sharedDevice')::boolean,false);
end;
$$;
revoke all on function public.anticheat_discord_event_allowed(bigint)
  from public,anon,authenticated,service_role;

create or replace function public.queue_anticheat_discord_alert() returns trigger
language plpgsql security definer set search_path='' as $$
declare event_row public.anticheat_events%rowtype; actor_name text; counterparty_name text;
  all_reasons text[]; related_names text[]; total_risk integer; alert_payload jsonb;
begin
  if new.risk_points<=0 or not public.anticheat_discord_event_allowed(new.event_id) then return new;end if;
  select * into event_row from public.anticheat_events where id=new.event_id;
  if not found then return new;end if;
  select coalesce(p.pseudo,'Player') into actor_name from public.user_profiles p where p.user_id=event_row.actor_user_id;
  select coalesce(p.pseudo,'Player') into counterparty_name from public.user_profiles p where p.user_id=event_row.counterparty_user_id;
  select coalesce(array_agg(distinct reason.code order by reason.code),'{}'::text[]),coalesce(sum(s.risk_points),0)::integer
    into all_reasons,total_risk
    from public.anticheat_event_subjects s cross join lateral unnest(s.reason_codes) as reason(code)
    where s.event_id=new.event_id;
  select coalesce(array_agg(distinct p.pseudo order by p.pseudo) filter(where p.pseudo is not null),'{}'::text[])
    into related_names from public.anticheat_event_subjects s
    join public.user_profiles p on p.user_id=s.user_id
    where s.event_id=new.event_id and s.user_id is distinct from event_row.actor_user_id;
  alert_payload:=jsonb_build_object('allowed_mentions',jsonb_build_object('parse','{}'::text[]),'embeds',jsonb_build_array(jsonb_build_object(
    'title','Yokkai · anti-cheat',
    'description',format('%s%s',event_row.event_type,case when actor_name is null then '' else format(' · %s%s',actor_name,case when counterparty_name is null then '' else ' → '||counterparty_name end) end),
    'color',15158332,
    'fields',jsonb_build_array(
      jsonb_build_object('name','Risk','value',total_risk::text,'inline',true),
      jsonb_build_object('name','Reasons','value',left(coalesce(array_to_string(all_reasons,', '),'Review required'),900),'inline',false)
    ) || case when cardinality(related_names)>0 then jsonb_build_array(
      jsonb_build_object('name','Accounts','value',left(array_to_string(related_names,', '),900),'inline',false)
    ) else '[]'::jsonb end || jsonb_build_array(
      jsonb_build_object('name','Details','value',format('%s card(s) · %s Karas · event #%s',event_row.card_count,event_row.amount,event_row.id),'inline',false)
    ),'timestamp',event_row.occurred_at
  )));
  insert into public.anticheat_discord_outbox(event_id,payload)
    values(new.event_id,alert_payload) on conflict(event_id) do update set payload=excluded.payload
      where public.anticheat_discord_outbox.dispatched_at is null;
  return new;
end;
$$;
revoke all on function public.queue_anticheat_discord_alert() from public,anon,authenticated,service_role;

create function public.archive_failed_anticheat_discord_alerts()
returns integer language plpgsql security definer set search_path='' as $$
declare item record; moved integer:=0;
begin
  for item in
    select event_id,payload,queued_at,attempts from public.anticheat_discord_outbox
    where dispatched_at is null and attempts>=12
    order by queued_at,event_id limit 100 for update skip locked
  loop
    insert into public.anticheat_discord_dead_letters(event_id,payload,queued_at,attempts,last_error)
      values(item.event_id,item.payload,item.queued_at,item.attempts,'DISPATCH_RETRY_LIMIT_REACHED')
      on conflict(event_id) do nothing;
    delete from public.anticheat_discord_outbox where event_id=item.event_id and dispatched_at is null;
    if found then moved:=moved+1; end if;
  end loop;
  return moved;
end;
$$;
revoke all on function public.archive_failed_anticheat_discord_alerts()
  from public,anon,authenticated,service_role;
select cron.schedule('archive-failed-anticheat-discord-alerts','*/5 * * * *','select public.archive_failed_anticheat_discord_alerts();');

notify pgrst,'reload schema';
commit;
