begin;

-- Store only the identifiers needed to reconcile, never the webhook payload.
create table public.whop_sandbox_webhook_jobs (
  scope text not null check (scope ~ '^sandbox:biz_[A-Za-z0-9]+:plan_[A-Za-z0-9]+$'),
  event_id text not null check (event_id ~ '^msg_[A-Za-z0-9]{1,100}$'),
  membership_id text not null check (membership_id ~ '^mem_[A-Za-z0-9]{1,100}$'),
  created_at timestamptz not null default clock_timestamp(),
  available_at timestamptz not null default clock_timestamp(),
  attempts integer not null default 0,
  lease_token uuid,
  processed_at timestamptz,
  primary key (scope,event_id)
);
create index whop_sandbox_webhook_jobs_pending
  on public.whop_sandbox_webhook_jobs(scope,available_at)
  where processed_at is null;
alter table public.whop_sandbox_webhook_jobs enable row level security;
revoke all on public.whop_sandbox_webhook_jobs from public,anon,authenticated;
grant select,insert,update on public.whop_sandbox_webhook_jobs to service_role;

create function public.whop_sandbox_claim_webhook(p_scope text, p_event_id text)
returns table(event_id text,membership_id text,lease_token uuid)
language sql volatile security invoker set search_path = '' as $$
  with candidate as (
    select j.scope,j.event_id
    from public.whop_sandbox_webhook_jobs j
    where j.scope=p_scope and (p_event_id is null or j.event_id=p_event_id)
      and j.processed_at is null and j.available_at<=clock_timestamp()
      and exists (select 1 from public.billing_entitlement_config c
        where c.singleton and c.whop_sandbox_scope=p_scope)
    order by j.available_at,j.event_id
    for update skip locked
    limit 1
  )
  update public.whop_sandbox_webhook_jobs j
    set lease_token=gen_random_uuid(), attempts=j.attempts+1,
        available_at=clock_timestamp()+make_interval(secs=>least(900, 30*power(2,least(j.attempts,5))))
    from candidate c
    where j.scope=c.scope and j.event_id=c.event_id
    returning j.event_id,j.membership_id,j.lease_token;
$$;
revoke all on function public.whop_sandbox_claim_webhook(text,text) from public,anon,authenticated;
grant execute on function public.whop_sandbox_claim_webhook(text,text) to service_role;

notify pgrst, 'reload schema';
commit;
