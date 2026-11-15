begin;

-- Keep image bytes with the message: sending, retries and account deletion are
-- atomic. Only the private media endpoint reads the bytes; lists return a flag.
alter table public.private_messages add column image_data bytea;

alter table public.private_messages drop constraint private_messages_content_check;
alter table public.private_messages add constraint private_messages_content_check check (
  (moderated_at is not null and body='' and gif_url is null and image_data is null)
  or (moderated_at is null and char_length(body)<=2000
    and (body !~ '^[[:space:]]*$' or gif_url is not null or image_data is not null)
    and (image_data is null or (gif_url is null and octet_length(image_data) between 1 and 6291456))
    and (gif_url is null or (char_length(gif_url)<=2048
      and gif_url ~ '^https://(media[0-9]*|i)\.giphy\.com/media/[A-Za-z0-9/_.-]+\.gif(\?[A-Za-z0-9_=&%.-]+)?$')))
);

create function public.private_message_image_type(p_image bytea)
returns text language sql immutable strict set search_path='' as $$
  select case
    when substring(p_image from 1 for 8)=decode('89504e470d0a1a0a','hex') then 'image/png'
    when substring(p_image from 1 for 3)=decode('ffd8ff','hex') then 'image/jpeg'
    when substring(p_image from 1 for 6) in (decode('474946383761','hex'),decode('474946383961','hex')) then 'image/gif'
    when substring(p_image from 1 for 4)=decode('52494646','hex')
     and substring(p_image from 9 for 4)=decode('57454250','hex') then 'image/webp'
  end
$$;
revoke all on function public.private_message_image_type(bytea) from public,anon,authenticated,service_role;

create function public.clear_moderated_private_message_image()
returns trigger language plpgsql set search_path='' as $$
begin
  if new.moderated_at is not null then new.image_data:=null; end if;
  return new;
end; $$;
revoke all on function public.clear_moderated_private_message_image() from public,anon,authenticated,service_role;
create trigger clear_moderated_private_message_image before update of moderated_at on public.private_messages
for each row execute function public.clear_moderated_private_message_image();

create function public.send_private_message_content(p_friend_id uuid,p_body text,p_id uuid,p_gif_url text,p_image bytea)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare viewer uuid:=auth.uid(); content text:=btrim(p_body); message public.private_messages;
begin
  perform public.assert_player_not_banned();
  if viewer is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_friend_id is null or p_friend_id=viewer then raise exception 'MESSAGES_UNAVAILABLE'; end if;
  perform pg_catalog.pg_advisory_xact_lock_shared(pg_catalog.hashtextextended('account-deletion:'||least(viewer,p_friend_id)::text,0));
  perform pg_catalog.pg_advisory_xact_lock_shared(pg_catalog.hashtextextended('account-deletion:'||greatest(viewer,p_friend_id)::text,0));
  perform public.lock_social_pair(viewer,p_friend_id);
  if not public.private_messaging_allowed(viewer,p_friend_id) then raise exception 'MESSAGES_UNAVAILABLE'; end if;
  if p_id is null or content is null or char_length(content)>2000
    or (content~'^[[:space:]]*$' and p_gif_url is null and p_image is null) then raise exception 'MESSAGE_INVALID'; end if;
  if p_gif_url is not null and (char_length(p_gif_url)>2048 or
    p_gif_url !~ '^https://(media[0-9]*|i)\.giphy\.com/media/[A-Za-z0-9/_.-]+\.gif(\?[A-Za-z0-9_=&%.-]+)?$') then raise exception 'MESSAGE_GIF_INVALID'; end if;
  if p_image is not null and (p_gif_url is not null or octet_length(p_image)>6291456
    or public.private_message_image_type(p_image) is null) then raise exception 'MESSAGE_IMAGE_INVALID'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('private-messages:'||viewer::text,0));
  select * into message from public.private_messages where id=p_id;
  if found then
    if message.sender_id<>viewer or message.recipient_id<>p_friend_id or message.body<>content
      or message.gif_url is distinct from p_gif_url or message.image_data is distinct from p_image then raise exception 'MESSAGE_CONFLICT'; end if;
  else
    if exists(select 1 from public.private_messages where sender_id=viewer and created_at>clock_timestamp()-interval '1 second')
      or (select count(*) from public.private_messages where sender_id=viewer and created_at>clock_timestamp()-interval '1 minute')>=30 then raise exception 'MESSAGE_RATE_LIMITED'; end if;
    insert into public.private_messages(id,sender_id,recipient_id,body,gif_url,image_data)
      values(p_id,viewer,p_friend_id,content,p_gif_url,p_image) returning * into message;
  end if;
  return jsonb_build_object('id',message.id,'senderId',message.sender_id,'recipientId',message.recipient_id,
    'text',message.body,'createdAt',message.created_at,'gifUrl',message.gif_url,'hasImage',message.image_data is not null);
end; $$;
revoke all on function public.send_private_message_content(uuid,text,uuid,text,bytea) from public,anon,authenticated,service_role;

create or replace function public.send_private_message_gif(p_friend_id uuid,p_body text,p_id uuid,p_gif_url text)
returns jsonb language sql volatile security definer set search_path='' as $$
  select public.assert_player_not_banned();
  select public.send_private_message_content(p_friend_id,p_body,p_id,p_gif_url,null)
$$;

create function public.send_private_message_image(p_friend_id uuid,p_body text,p_id uuid,p_image text)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare image bytea;
begin
  perform public.assert_player_not_banned();
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_image is null or length(p_image)>8388608 then raise exception 'MESSAGE_IMAGE_INVALID'; end if;
  begin
    image:=decode(p_image,'base64');
  exception when invalid_parameter_value then
    raise exception 'MESSAGE_IMAGE_INVALID';
  end;
  return public.send_private_message_content(p_friend_id,p_body,p_id,null,image);
end; $$;

create function public.get_private_message_image(p_message_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare viewer uuid:=auth.uid(); picture bytea;
begin
  if viewer is null then return null; end if;
  perform public.assert_player_not_banned();
  select m.image_data into picture from public.private_messages m
  where m.id=p_message_id and m.moderated_at is null and m.image_data is not null
    and viewer in (m.sender_id,m.recipient_id)
    and public.private_messaging_allowed(viewer,case when viewer=m.sender_id then m.recipient_id else m.sender_id end);
  if picture is null then return null; end if;
  return jsonb_build_object('type',public.private_message_image_type(picture),'data',encode(picture,'base64'));
end; $$;

revoke all on function public.send_private_message_image(uuid,text,uuid,text),
  public.get_private_message_image(uuid) from public,anon,authenticated,service_role;
grant execute on function public.send_private_message_image(uuid,text,uuid,text),
  public.get_private_message_image(uuid) to authenticated;

create or replace function public.get_private_messages(p_friend_id uuid,p_before timestamptz default null,p_before_id uuid default null,p_limit integer default 40)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare viewer uuid:=auth.uid(); page_size integer:=least(100,greatest(1,coalesce(p_limit,40))); result jsonb;
begin
  if viewer is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.private_messaging_allowed(viewer,p_friend_id) then raise exception 'MESSAGES_UNAVAILABLE'; end if;
  if (p_before is null)<>(p_before_id is null) then raise exception 'MESSAGE_CURSOR_INVALID'; end if;
  with page as materialized (
    select m.id,m.sender_id,m.recipient_id,m.body,m.created_at,m.gif_url,m.moderated_at,
      m.read_order,m.image_data is not null as has_image from public.private_messages m
    where m.pair_low=least(viewer,p_friend_id) and m.pair_high=greatest(viewer,p_friend_id)
      and (p_before is null or (m.created_at,m.id)<(p_before,p_before_id))
    order by m.created_at desc,m.id desc limit page_size+1
  ), visible as (select * from page order by created_at desc,id desc limit page_size)
  select jsonb_build_object('viewerId',viewer,
    'items',coalesce((select jsonb_agg(jsonb_build_object('id',id,'senderId',sender_id,'recipientId',recipient_id,
      'text',body,'createdAt',created_at,'gifUrl',gif_url,'hasImage',has_image,'moderated',moderated_at is not null) order by created_at,id) from visible),'[]'::jsonb),
    'readThroughId',(select id from visible where recipient_id=viewer order by read_order desc limit 1),
    'next',case when (select count(*) from page)>page_size then
      (select jsonb_build_object('at',created_at,'id',id) from visible order by created_at,id limit 1) else null end
  ) into result;
  return result;
end; $$;

create or replace function public.get_private_conversations(
  p_before timestamptz default null,p_before_id uuid default null,p_limit integer default 30
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare viewer uuid:=auth.uid(); page_size integer:=least(50,greatest(1,coalesce(p_limit,30))); result jsonb;
begin
  if viewer is null then raise exception 'AUTH_REQUIRED'; end if;
  perform public.assert_player_not_banned();
  if (p_before is null)<>(p_before_id is null) then raise exception 'MESSAGE_CURSOR_INVALID';end if;
  with friends as materialized (
    select distinct case when f.user_id=viewer then f.friend_id else f.user_id end friend_id
    from public.friendships f where f.status='accepted' and viewer in(f.user_id,f.friend_id)
  ), permitted as materialized (
    select friend_id from friends where public.private_messaging_allowed(viewer,friend_id)
  ), latest as materialized (
    select p.user_id friend_id,p.pseudo,p.avatar_url,m.created_at,m.sender_id,m.body,m.gif_url,m.moderated_at,m.has_image
    from permitted a join public.user_profiles p on p.user_id=a.friend_id
    cross join lateral (
      select m.created_at,m.sender_id,m.body,m.gif_url,m.moderated_at,m.image_data is not null as has_image from public.private_messages m
      where m.pair_low=least(viewer,a.friend_id) and m.pair_high=greatest(viewer,a.friend_id)
      order by m.created_at desc,m.id desc limit 1
    )m
  ), page as materialized (
    select * from latest where p_before is null or(created_at,friend_id)<(p_before,p_before_id)
    order by created_at desc,friend_id desc limit page_size+1
  ), visible as materialized (select * from page order by created_at desc,friend_id desc limit page_size)
  select jsonb_build_object('viewerId',viewer,
    'items',coalesce((select jsonb_agg(jsonb_build_object(
      'friend',jsonb_build_object('id',friend_id,'pseudo',pseudo,'avatarUrl',avatar_url,
        'profileStyle',public.billing_profile_cosmetics(friend_id)),
      'lastAt',created_at,'own',sender_id=viewer,
      'preview',case when moderated_at is not null then '' else left(body,160) end,
      'kind',case when moderated_at is not null then 'moderated' when body='' and gif_url is not null then 'gif' when body='' and has_image then 'image' else 'text' end
    )order by created_at desc,friend_id desc)from visible),'[]'::jsonb),
    'next',case when(select count(*)from page)>page_size then
      (select jsonb_build_object('at',created_at,'id',friend_id)from visible order by created_at,friend_id limit 1)
      else null end)into result;
  return result;
end;$$;

commit;
