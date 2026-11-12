begin;
set local lock_timeout='5s';

create table public.anticheat_farm_reviews (
  id uuid primary key default gen_random_uuid(),
  cluster_id uuid not null,
  evidence_version text not null,
  evidence_snapshot jsonb not null,
  reviewer_id uuid not null,
  decision text not null check(decision in('CONFIRMED','DISMISSED')),
  reason text not null check(length(btrim(reason)) between 10 and 500),
  reviewed_at timestamptz not null default clock_timestamp(),
  unique(cluster_id,evidence_version)
);
alter table public.anticheat_farm_reviews enable row level security;
revoke all on public.anticheat_farm_reviews from public,anon,authenticated,service_role;
create trigger anticheat_farm_reviews_immutable
  before update or delete on public.anticheat_farm_reviews
  for each row execute function public.prevent_anticheat_ledger_mutation();

-- A rescan with identical evidence leaves the review version unchanged.
create function public.anticheat_farm_evidence_version(p_case public.anticheat_farm_evidence)
returns text language sql immutable set search_path='' as $$
  select md5(jsonb_build_array(p_case.beneficiary_id,p_case.secondary_ids,p_case.risk_score,
    p_case.confidence,p_case.decision,p_case.evidence)::text)
$$;
revoke all on function public.anticheat_farm_evidence_version(public.anticheat_farm_evidence)
  from public,anon,authenticated,service_role;

create function public.admin_review_anticheat_farm(
  p_id uuid,p_version text,p_decision text,p_reason text
)
returns text language plpgsql security definer set search_path='' as $$
declare f public.anticheat_farm_evidence%rowtype; previous text;
begin
  perform public.assert_player_not_banned();
  if not public.is_current_user_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  if p_decision is null or p_decision not in('CONFIRMED','DISMISSED')
    or length(btrim(coalesce(p_reason,''))) not between 10 and 500 then
    raise exception 'INVALID_FARM_REVIEW';
  end if;
  select evidence.* into f
  from public.anticheat_farm_evidence evidence
  join public.anticheat_network_clusters c on c.id=evidence.cluster_id
  where evidence.cluster_id=p_id and evidence.evaluated_cluster_at=c.evaluated_at
  for update of c,evidence;
  if not found or p_version is distinct from public.anticheat_farm_evidence_version(f) then
    raise exception 'FARM_EVIDENCE_CHANGED';
  end if;
  if p_decision='CONFIRMED' and f.decision<>'ECONOMICALLY_CONFIRMED' then
    raise exception 'FARM_EVIDENCE_INSUFFICIENT';
  end if;
  select decision into previous from public.anticheat_farm_reviews
    where cluster_id=f.cluster_id and evidence_version=p_version;
  if found then
    if previous=p_decision then return previous; end if;
    raise exception 'FARM_ALREADY_REVIEWED';
  end if;
  insert into public.anticheat_farm_reviews(
    cluster_id,evidence_version,evidence_snapshot,reviewer_id,decision,reason
  ) values(
    f.cluster_id,p_version,to_jsonb(f),auth.uid(),p_decision,btrim(p_reason)
  );
  return p_decision;
end;
$$;
revoke all on function public.admin_review_anticheat_farm(uuid,text,text,text)
  from public,anon,authenticated,service_role;
grant execute on function public.admin_review_anticheat_farm(uuid,text,text,text) to authenticated;

do $farm_review_dto$
declare definition text; updated text;
begin
  definition:=pg_get_functiondef('public.admin_list_anticheat_clusters(uuid)'::regprocedure);
  updated:=replace(definition,'''farmEvidence'',case when p_id is not null then f.evidence end,',
    '''farmEvidence'',case when p_id is not null then f.evidence end,
     ''farmVersion'',case when f.evaluated_cluster_at=c.evaluated_at
       then public.anticheat_farm_evidence_version(f) end,
     ''farmReview'',r.decision,');
  updated:=replace(updated,'left join public.user_profiles b on b.user_id=f.beneficiary_id',
    'left join public.user_profiles b on b.user_id=f.beneficiary_id
     left join public.anticheat_farm_reviews r on r.cluster_id=c.id
       and r.evidence_version=public.anticheat_farm_evidence_version(f)');
  if updated=definition or strpos(updated,'''farmVersion''')=0 or strpos(updated,'r.cluster_id=c.id')=0 then
    raise exception 'UNEXPECTED_FARM_REVIEW_DTO';
  end if;
  execute updated;
end
$farm_review_dto$;
notify pgrst,'reload schema';
commit;
