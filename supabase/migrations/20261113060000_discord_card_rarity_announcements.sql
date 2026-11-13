begin;
set local lock_timeout='5s';

-- Dedicated player-server destination, never shared with moderation webhooks.
-- Provision through an operator SQL session; no secret belongs in the repository.
create table public.card_rarity_discord_config (
  id boolean primary key default true check(id),
  enabled boolean not null default false,
  webhook_url text not null check(webhook_url~'^https://discord\.com/api/webhooks/[0-9]+/[A-Za-z0-9._-]+$')
);
create table public.card_rarity_discord_outbox (
  id bigint generated always as identity primary key,
  card_id uuid not null,
  old_rarity public.card_rarity not null,
  new_rarity public.card_rarity not null,
  payload jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  status text not null default 'PENDING' check(status in('PENDING','SENT','FAILED')),
  attempts integer not null default 0 check(attempts between 0 and 12),
  request_id bigint,
  attempted_at timestamptz,
  retry_at timestamptz not null default clock_timestamp(),
  sent_at timestamptz,
  last_error text,
  check(old_rarity<>new_rarity)
);
create index card_rarity_discord_pending_idx on public.card_rarity_discord_outbox(id) where status='PENDING';
alter table public.card_rarity_discord_config enable row level security;
alter table public.card_rarity_discord_outbox enable row level security;
revoke all on public.card_rarity_discord_config,public.card_rarity_discord_outbox from public,anon,authenticated,service_role;
revoke all on sequence public.card_rarity_discord_outbox_id_seq from public,anon,authenticated,service_role;

create function public.queue_card_rarity_announcement()
returns trigger language plpgsql security definer set search_path='' as $$
declare message jsonb; event_id bigint; stamp timestamptz:=clock_timestamp();
begin
  if not exists(select 1 from public.card_rarity_discord_config where id and enabled) then return new; end if;
  message:=jsonb_build_object(
    'title','Rareté mise à jour',
    'url','https://yokkai-collec.com/catalog',
    'color',case new.rarete_base when 'LR' then 16766779 when 'SSR' then 16731048 when 'SR' then 12747263 else 10142942 end,
    'fields',jsonb_build_array(
      jsonb_build_object('name','Carte','value',left(new.nom,500),'inline',false),
      jsonb_build_object('name','Licence','value',left(coalesce(nullif(new.franchise,''),new.categorie),500),'inline',false),
      jsonb_build_object('name','Ancienne rareté','value',old.rarete_base::text,'inline',true),
      jsonb_build_object('name','Nouvelle rareté','value',new.rarete_base::text,'inline',true)
    ),
    'timestamp',stamp
  );
  if new.image_url~'^https://' and length(new.image_url)<=2048 then
    message:=message||jsonb_build_object('thumbnail',jsonb_build_object('url',new.image_url));
  end if;
  insert into public.card_rarity_discord_outbox(card_id,old_rarity,new_rarity,payload,created_at)
    values(new.id,old.rarete_base,new.rarete_base,'{}',stamp) returning id into event_id;
  message:=message||jsonb_build_object('footer',jsonb_build_object('text','Yokkai Collec · Modification n° '||event_id));
  update public.card_rarity_discord_outbox set payload=jsonb_build_object(
    'username','Yokkai · Cartes',
    'allowed_mentions',jsonb_build_object('parse','[]'::jsonb),
    'embeds',jsonb_build_array(message)
  ) where id=event_id;
  return new;
end;
$$;
revoke all on function public.queue_card_rarity_announcement() from public,anon,authenticated,service_role;
create trigger queue_card_rarity_announcement after update of rarete_base on public.cards
  for each row when(old.rarete_base is distinct from new.rarete_base)
  execute function public.queue_card_rarity_announcement();

-- One in-flight message per destination. Acknowledgement precedes the next send,
-- so overlapping cron invocations cannot re-send a confirmed announcement.
create function public.dispatch_card_rarity_announcements()
returns integer language plpgsql security definer set search_path='' as $$
declare config public.card_rarity_discord_config%rowtype; item public.card_rarity_discord_outbox%rowtype;
  response record; pending_request bigint; delay_seconds numeric:=60;
begin
  if not pg_try_advisory_xact_lock(hashtextextended('card-rarity-discord-dispatch',0)) then return 0; end if;
  select * into config from public.card_rarity_discord_config where id and enabled;
  if not found then return 0; end if;
  select * into item from public.card_rarity_discord_outbox where status='PENDING' order by id limit 1 for update;
  if not found then return 0; end if;
  if item.request_id is not null then
    execute 'select status_code,timed_out,error_msg,content from net._http_response where id=$1'
      into response using item.request_id;
    if response.status_code is null and response.timed_out is null and response.error_msg is null then
      if item.attempted_at<clock_timestamp()-interval '5 minutes' then
        update public.card_rarity_discord_outbox set status='FAILED',last_error='DELIVERY_UNCONFIRMED',request_id=null where id=item.id;
      end if;
      return 0;
    end if;
    if response.status_code between 200 and 299 and not coalesce(response.timed_out,false) and response.error_msg is null then
      update public.card_rarity_discord_outbox set status='SENT',sent_at=clock_timestamp(),request_id=null,last_error=null where id=item.id;
    else
      if response.status_code=429 then
        begin
          delay_seconds:=greatest(60,least(86400,coalesce((response.content::jsonb->>'retry_after')::numeric,60)));
        exception when others then delay_seconds:=60; end;
      end if;
      update public.card_rarity_discord_outbox set request_id=null,
        status=case when item.attempts>=12 or response.status_code is null or response.status_code not in(429,500,502,503,504) then 'FAILED' else 'PENDING' end,
        retry_at=clock_timestamp()+make_interval(secs=>delay_seconds::double precision),
        last_error=case when response.status_code is null then 'DELIVERY_UNCONFIRMED' else 'HTTP_'||response.status_code end
        where id=item.id;
      return 0;
    end if;
    select * into item from public.card_rarity_discord_outbox where status='PENDING' order by id limit 1 for update;
    if not found then return 0; end if;
  end if;
  if item.retry_at>clock_timestamp() then return 0; end if;
  -- wait=true makes Discord acknowledge message creation, rather than merely
  -- accepting an asynchronous webhook execution.
  execute 'select net.http_post(url := $1,body := $2,headers := $3,timeout_milliseconds := 5000)'
    into pending_request using config.webhook_url||'?wait=true',item.payload,jsonb_build_object('Content-Type','application/json');
  update public.card_rarity_discord_outbox set request_id=pending_request,attempts=attempts+1,attempted_at=clock_timestamp() where id=item.id;
  return 1;
end;
$$;
revoke all on function public.dispatch_card_rarity_announcements() from public,anon,authenticated,service_role;
select cron.schedule('dispatch-card-rarity-announcements','* * * * *','select public.dispatch_card_rarity_announcements();');
commit;
