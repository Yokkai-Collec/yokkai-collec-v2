begin;
set local lock_timeout = '5s';

do $$
declare definition text;
begin
  select pg_get_constraintdef(oid) into strict definition from pg_constraint
    where conrelid = 'public.notifications'::regclass and conname = 'notifications_type_check';
  alter table public.notifications drop constraint notifications_type_check;
  execute 'alter table public.notifications add constraint notifications_type_check check '
    || '(type in (''wall_post_mention'', ''wall_reply_mention'') or ('
    || substring(definition from 8 for char_length(definition) - 8) || '))';
end;
$$;

create index notifications_wall_mention_reference_idx
on public.notifications (reference_id)
where type in ('wall_post_mention', 'wall_reply_mention');

create function public.find_wall_mention_players(p_pseudos text[], p_prefix boolean default false)
returns table("userId" uuid, pseudo text)
language sql stable security definer set search_path = '' as $$
  with queries as (
    select distinct lower(query) as name
    from unnest(p_pseudos[1:100]) as query
    where char_length(query) between 2 and 30
  )
  select p.user_id, p.pseudo
  from public.user_profiles p
  where not p_prefix
    and lower(p.pseudo) in (select name from queries)
    and public.wall_reply_author_visible(auth.uid())
    and public.wall_reply_author_visible(p.user_id)
  union all
  (select p.user_id, p.pseudo
   from public.user_profiles p
   where p_prefix
     and array_length(p_pseudos, 1) = 1
     and starts_with(lower(p.pseudo), (select name from queries))
     and p.user_id <> auth.uid()
     and public.wall_reply_author_visible(auth.uid())
     and public.wall_reply_author_visible(p.user_id)
   order by lower(p.pseudo), p.user_id
   limit 8)
$$;

create function public.notify_wall_mentions() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  is_post boolean := tg_table_name = 'profile_wall_posts';
  note_type text := case when is_post then 'wall_post_mention' else 'wall_reply_mention' end;
  post_id uuid;
begin
  if tg_op = 'DELETE' then
    delete from public.notifications n
    where n.type in ('wall_post_mention', 'wall_reply_mention')
      and n.type = note_type and n.reference_id = old.id;
    return old;
  end if;

  if new.user_id is distinct from auth.uid() or strpos(coalesce(new.body, ''), '@') = 0 then
    return new;
  end if;
  if is_post then
    post_id := new.id;
  else
    post_id := new.post_id;
  end if;
  if not public.wall_post_interaction_allowed(new.user_id, post_id) then return new; end if;

  -- Keep this syntax aligned with wallMentionParts. The delimited form covers
  -- pseudonyms with spaces and punctuation. Plain emails are excluded.
  insert into public.notifications(user_id, type, reference_id, actor_user_id)
  select p.user_id, note_type, new.id, new.user_id
  from (
    select distinct lower(coalesce(captures[1], captures[2])) as pseudo
    from regexp_matches(new.body,
      $pattern$(?<![[:alnum:]_.@-])@(?:<([^<>\n\r]{2,30})>|([[:alnum:]_-]+(?:\.+[[:alnum:]_-]+)*))(?![[:alnum:]_@-]|\.[[:alnum:]_])$pattern$,
      'g') as tokens(captures)
    where char_length(coalesce(captures[1], captures[2])) between 2 and 30
  ) names
  join public.user_profiles p on lower(p.pseudo) = names.pseudo
  where p.user_id <> new.user_id
    and public.wall_reply_author_visible(p.user_id)
    and public.wall_post_interaction_allowed(p.user_id, post_id)
  on conflict (user_id, type, reference_id) do nothing;
  return new;
end;
$$;

create trigger wall_post_mentions
after insert or delete on public.profile_wall_posts
for each row execute function public.notify_wall_mentions();

-- Alphabetical trigger order lets the reply notifier skip a second alert to
-- a player who already received a mention for this reply.
create trigger wall_post_replies_mentions
after insert or delete on public.wall_post_replies
for each row execute function public.notify_wall_mentions();

create function public.wall_mention_notification_context(note public.notifications)
returns jsonb language sql stable set search_path = '' as $$
  select case
    when note.type = 'wall_post_mention' then (
      select jsonb_build_object('postOwnerId', p.user_id, 'postId', p.id)
      from public.profile_wall_posts p
      where p.id = note.reference_id and p.user_id = note.actor_user_id
        and auth.uid() = note.user_id
        and public.wall_post_interaction_allowed(note.user_id, p.id)
    )
    when note.type = 'wall_reply_mention' then (
      select jsonb_build_object('postOwnerId', p.user_id, 'postId', p.id, 'replyId', r.id)
      from public.wall_post_replies r join public.profile_wall_posts p on p.id = r.post_id
      where r.id = note.reference_id and r.user_id = note.actor_user_id
        and auth.uid() = note.user_id
        and public.wall_reply_author_visible(r.user_id)
        and public.wall_post_interaction_allowed(note.user_id, p.id)
    )
    else '{}'::jsonb
  end
$$;

do $$
declare
  target regprocedure;
  definition text;
  projection text := '|| public.progress_notification_details(n)';
  visibility text := 'and not public.users_blocked(player_id,public.interaction_notification_actor(notifications))';
  actor_lookup text := 'when n.type=''friend_request'' then';
  reply_guard text := 'begin' || chr(10) || '  if new.parent_reply_id is not null then';
  insert_note text := '  insert into public.notifications(user_id,type,reference_id,actor_user_id,created_at)';
  dedup text := $guard$exists (select 1 from public.notifications n
    where n.user_id = owner_id and n.type = 'wall_reply_mention' and n.reference_id = new.id)$guard$;
begin
  foreach target in array array[
    'public.list_notifications(integer)'::regprocedure,
    'public.get_push_notification(uuid,timestamptz)'::regprocedure
  ] loop
    definition := pg_get_functiondef(target);
    if strpos(definition, projection) = 0 or strpos(definition, visibility) = 0 then
      raise exception 'WALL_MENTION_NOTIFICATION_PATCH_MISMATCH (%)', target;
    end if;
    execute replace(replace(definition,
      projection, projection || ' || public.wall_mention_notification_context(n)'),
      visibility, visibility || ' and public.wall_mention_notification_context(notifications) is not null');
  end loop;

  definition := pg_get_functiondef('public.interaction_notification_actor(public.notifications)'::regprocedure);
  if strpos(definition, actor_lookup) = 0 then raise exception 'WALL_MENTION_ACTOR_PATCH_MISMATCH'; end if;
  execute replace(definition, actor_lookup,
    'when n.type in (''wall_post_mention'', ''wall_reply_mention'') then n.actor_user_id ' || actor_lookup);

  definition := pg_get_functiondef('public.notify_wall_post_reply()'::regprocedure);
  if strpos(definition, reply_guard) = 0 or strpos(definition, chr(10) || insert_note) = 0
    or strpos(definition, 'if owner_id is not null and owner_id<>new.user_id') = 0 then
    raise exception 'WALL_MENTION_REPLY_PATCH_MISMATCH';
  end if;
  execute replace(replace(definition, 'if owner_id is not null and owner_id<>new.user_id',
    'if owner_id is not null and owner_id<>new.user_id and not ' || dedup),
    chr(10) || insert_note, chr(10) || '  if ' || dedup || ' then return new; end if;' || chr(10) || insert_note);
end;
$$;

revoke all on function public.find_wall_mention_players(text[], boolean),
  public.notify_wall_mentions(), public.wall_mention_notification_context(public.notifications)
  from public, anon, authenticated, service_role;
grant execute on function public.find_wall_mention_players(text[], boolean) to authenticated;
notify pgrst, 'reload schema';
commit;
