begin;

create table public.karas_gift_codes (
  code_hash bytea primary key,
  amount integer not null check (amount > 0),
  message text not null check (char_length(message) between 1 and 500),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  shareable boolean not null default false,
  consumed_at timestamptz
);
create index karas_gift_codes_creator_idx on public.karas_gift_codes(created_by);
create table public.karas_gift_redemptions (
  code_hash bytea not null references public.karas_gift_codes(code_hash) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  redeemed_at timestamptz not null default clock_timestamp(),
  primary key (code_hash, recipient_id)
);
create index karas_gift_redemptions_recipient_idx on public.karas_gift_redemptions(recipient_id);
alter table public.karas_gift_codes enable row level security;
alter table public.karas_gift_redemptions enable row level security;
revoke all on public.karas_gift_codes, public.karas_gift_redemptions from public, anon, authenticated, service_role;

create function public.admin_create_karas_gift_code(p_amount integer, p_message text, p_shareable boolean default false)
returns text language plpgsql volatile security definer set search_path='' as $$
declare
  issuer uuid := auth.uid();
  message_text text;
  secret text;
begin
  perform public.assert_player_not_banned();
  if not public.is_current_user_admin() then raise exception 'GIFT_CODE_FORBIDDEN'; end if;
  if p_message is null or char_length(p_message)>500 then raise exception 'GIFT_CODE_DETAILS_INVALID'; end if;
  message_text := regexp_replace(p_message,'^[[:space:]]+|[[:space:]]+$','','g');
  if p_amount is null or p_amount < 1 or p_shareable is null
    or char_length(message_text) not between 1 and 500 then
    raise exception 'GIFT_CODE_DETAILS_INVALID';
  end if;

  secret := upper(encode(extensions.gen_random_bytes(12),'hex'));
  insert into public.karas_gift_codes(code_hash, amount, message, created_by, shareable)
    values (sha256(convert_to(secret,'UTF8')), p_amount, message_text, issuer, p_shareable);
  return regexp_replace(secret,'(.{4})(?=.)','\1-','g');
end;
$$;

create function public.redeem_karas_gift_code(p_code text)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare
  player uuid := auth.uid();
  normalized text;
  gift public.karas_gift_codes;
  already_redeemed boolean;
begin
  perform public.assert_player_not_banned();
  if player is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_code is null or char_length(p_code) > 64 then raise exception 'GIFT_CODE_UNAVAILABLE'; end if;
  normalized := upper(regexp_replace(p_code,'[[:space:]-]','','g'));
  if normalized !~ '^[0-9A-F]{24}$' then raise exception 'GIFT_CODE_UNAVAILABLE'; end if;

  perform pg_advisory_xact_lock_shared(hashtextextended('account-deletion:'||player::text,0));
  select * into gift from public.karas_gift_codes
    where code_hash=sha256(convert_to(normalized,'UTF8')) for update;

  if not found then raise exception 'GIFT_CODE_UNAVAILABLE'; end if;
  select exists(select 1 from public.karas_gift_redemptions
    where code_hash=gift.code_hash and recipient_id=player) into already_redeemed;

  if not already_redeemed then
    if not gift.shareable and gift.consumed_at is not null then
      raise exception 'GIFT_CODE_UNAVAILABLE';
    end if;
    begin
      perform public.credit_karas(player,gift.amount);
    exception when numeric_value_out_of_range then
      raise exception 'GIFT_CODE_BALANCE_LIMIT';
    end;
    insert into public.karas_gift_redemptions(code_hash,recipient_id) values(gift.code_hash,player);
    -- The one-use marker survives deletion of the recipient's account.
    if not gift.shareable then
      update public.karas_gift_codes set consumed_at=clock_timestamp() where code_hash=gift.code_hash;
    end if;
  end if;
  return jsonb_build_object('amount',gift.amount,'message',gift.message,'alreadyRedeemed',already_redeemed);
end;
$$;

revoke all on function public.admin_create_karas_gift_code(integer,text,boolean), public.redeem_karas_gift_code(text)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_create_karas_gift_code(integer,text,boolean), public.redeem_karas_gift_code(text)
  to authenticated;

notify pgrst,'reload schema';
commit;
