begin;
set local lock_timeout = '5s';

alter table public.karas_gift_codes
  add column history_id uuid not null default gen_random_uuid() unique,
  add column code_suffix text check (code_suffix ~ '^[0-9A-F]{4}$'),
  add column redemption_count bigint not null default 0 check (redemption_count >= 0);

update public.karas_gift_codes g set redemption_count = greatest(
  (select count(*) from public.karas_gift_redemptions r where r.code_hash = g.code_hash),
  (g.consumed_at is not null)::integer
);

create or replace function public.admin_create_karas_gift_code(p_amount integer, p_message text, p_shareable boolean default false)
returns text language plpgsql volatile security definer set search_path = '' as $$
declare
  issuer uuid := auth.uid();
  message_text text;
  secret text;
begin
  perform public.assert_player_not_banned();
  if not public.is_current_user_admin() then raise exception 'GIFT_CODE_FORBIDDEN'; end if;
  if p_message is null or char_length(p_message) > 500 then raise exception 'GIFT_CODE_DETAILS_INVALID'; end if;
  message_text := regexp_replace(p_message, '^[[:space:]]+|[[:space:]]+$', '', 'g');
  if p_amount is null or p_amount < 1 or p_shareable is null or char_length(message_text) not between 1 and 500
  then raise exception 'GIFT_CODE_DETAILS_INVALID'; end if;

  secret := upper(encode(extensions.gen_random_bytes(12), 'hex'));
  insert into public.karas_gift_codes(code_hash, amount, message, created_by, shareable, code_suffix)
  values (sha256(convert_to(secret, 'UTF8')), p_amount, message_text, issuer, p_shareable, right(secret, 4));
  return regexp_replace(secret, '(.{4})(?=.)', '\1-', 'g');
end $$;

create or replace function public.redeem_karas_gift_code(p_code text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  player uuid := auth.uid();
  normalized text;
  gift public.karas_gift_codes;
  already_redeemed boolean;
begin
  perform public.assert_player_not_banned();
  if player is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_code is null or char_length(p_code) > 64 then raise exception 'GIFT_CODE_UNAVAILABLE'; end if;
  normalized := upper(regexp_replace(p_code, '[[:space:]-]', '', 'g'));
  if normalized !~ '^[0-9A-F]{24}$' then raise exception 'GIFT_CODE_UNAVAILABLE'; end if;

  perform pg_advisory_xact_lock_shared(hashtextextended('account-deletion:' || player::text, 0));
  select * into gift from public.karas_gift_codes where code_hash = sha256(convert_to(normalized, 'UTF8')) for update;
  if not found then raise exception 'GIFT_CODE_UNAVAILABLE'; end if;
  select exists (select 1 from public.karas_gift_redemptions
    where code_hash = gift.code_hash and recipient_id = player) into already_redeemed;

  if not already_redeemed then
    if not gift.shareable and gift.consumed_at is not null then raise exception 'GIFT_CODE_ALREADY_USED'; end if;
    begin
      perform public.credit_karas(player, gift.amount);
    exception when numeric_value_out_of_range then
      raise exception 'GIFT_CODE_BALANCE_LIMIT';
    end;
    insert into public.karas_gift_redemptions(code_hash, recipient_id) values (gift.code_hash, player);
    -- The aggregate count and the one-use marker survive account deletion.
    update public.karas_gift_codes set redemption_count = redemption_count + 1,
      consumed_at = case when not shareable then clock_timestamp() end where code_hash = gift.code_hash;
  end if;
  return jsonb_build_object('amount', gift.amount, 'message', gift.message, 'alreadyRedeemed', already_redeemed);
end $$;

create index karas_gift_codes_history_order on public.karas_gift_codes(created_at desc, history_id desc);
create index karas_gift_redemptions_history_order on public.karas_gift_redemptions(code_hash, redeemed_at desc, recipient_id desc);

create function public.admin_get_karas_gift_history(p_page integer default 1, p_gift_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare page_size constant integer := 20; requested_page integer := greatest(1, coalesce(p_page, 1));
begin
  perform public.assert_player_not_banned();
  if not public.is_current_user_admin() then raise exception 'GIFT_CODE_FORBIDDEN'; end if;

  if p_gift_id is null then
    return (with bounds as (
      select count(*) as total, least(requested_page, greatest(1, (count(*) + page_size - 1) / page_size)) as page
      from public.karas_gift_codes
    ), current_page as (
      select g.history_id, g.code_suffix, g.amount, g.message, g.shareable, g.created_at, g.redemption_count,
        p.user_id as creator_id, p.pseudo as creator_name
      from public.karas_gift_codes g left join public.user_profiles p on p.user_id = g.created_by
      order by g.created_at desc, g.history_id desc limit page_size offset (select (page - 1) * page_size from bounds)
    ) select jsonb_build_object('page', page, 'total', total, 'items', coalesce((
      select jsonb_agg(jsonb_build_object('id', history_id, 'suffix', code_suffix, 'amount', amount,
        'message', message, 'shareable', shareable, 'createdAt', created_at, 'redemptionCount', redemption_count,
        'creatorId', creator_id, 'creatorName', creator_name) order by created_at desc, history_id desc)
      from current_page
    ), '[]'::jsonb)) from bounds);
  end if;

  return (with gift as (
    select code_hash from public.karas_gift_codes where history_id = p_gift_id
  ), bounds as (
    select count(*) as total, least(requested_page, greatest(1, (count(*) + page_size - 1) / page_size)) as page
    from public.karas_gift_redemptions r join gift on gift.code_hash = r.code_hash
  ), current_page as (
    select r.recipient_id, r.redeemed_at, p.pseudo
    from public.karas_gift_redemptions r join gift on gift.code_hash = r.code_hash
    left join public.user_profiles p on p.user_id = r.recipient_id
    order by r.redeemed_at desc, r.recipient_id desc limit page_size offset (select (page - 1) * page_size from bounds)
  ) select jsonb_build_object('page', page, 'total', total, 'items', coalesce((
    select jsonb_agg(jsonb_build_object('recipientId', recipient_id, 'recipientName', pseudo, 'redeemedAt', redeemed_at)
      order by redeemed_at desc, recipient_id desc) from current_page
  ), '[]'::jsonb)) from bounds);
end $$;
revoke all on function public.admin_get_karas_gift_history(integer, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_get_karas_gift_history(integer, uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
