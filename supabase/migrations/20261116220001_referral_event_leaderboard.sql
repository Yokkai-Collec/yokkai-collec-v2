begin;
-- Same qualification and public-profile/blocking policy as referral rankings.
-- Only aggregate counts and public pseudos leave the server, never child data.
create function public.referral_event_leaderboard(p_event uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 with counts as materialized (
  select p.user_id,p.pseudo,p.is_public,count(*) valid_count
  from public.referral_event_qualified(p_event) q
  join public.user_profiles p on p.user_id=q.referrer_id
  group by p.user_id,p.pseudo,p.is_public
 ), ranked as materialized (
  select *,rank() over(order by valid_count desc) position from counts where is_public
 ), visible as (
  select * from ranked where not public.users_blocked(auth.uid(),user_id)
  order by valid_count desc,lower(pseudo),user_id limit 20
 )
 select jsonb_build_object(
  'entries',coalesce((select jsonb_agg(jsonb_build_object(
   'pseudo',pseudo,'position',position,'validCount',valid_count,'mine',user_id=auth.uid()
  ) order by valid_count desc,lower(pseudo),user_id) from visible),'[]'::jsonb),
  'mine',(select jsonb_build_object('position',(select position from ranked where user_id=p.user_id),
   'validCount',coalesce((select valid_count from counts where user_id=p.user_id),0),'isPublic',p.is_public)
   from public.user_profiles p where p.user_id=auth.uid())
 );
$$;
revoke all on function public.referral_event_leaderboard(uuid) from public,anon,authenticated,service_role;
do $$ declare definition text; updated text; begin
 definition:=pg_get_functiondef('public.get_referral_event()'::regprocedure);
 updated:=replace(definition,'''pending'',(select',
  '''leaderboard'',public.referral_event_leaderboard(event_row.id),''pending'',(select');
 if updated=definition then raise exception 'REFERRAL_EVENT_LEADERBOARD_PATCH_MISSING'; end if;
 execute updated;
end $$;
notify pgrst,'reload schema';
commit;
