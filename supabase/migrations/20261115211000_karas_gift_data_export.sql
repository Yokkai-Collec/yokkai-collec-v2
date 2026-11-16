begin;
set local lock_timeout='3s';

-- Add the recipient's gift receipts to the existing bounded, service-only
-- export. The lookup hash and issuer identity stay private.
do $export$
declare source text; marker text := 'return result;';
begin
  source := pg_get_functiondef('public.build_data_export(uuid,uuid)'::regprocedure);
  if array_length(string_to_array(source,marker),1) <> 2 then
    raise exception 'KARAS_GIFT_EXPORT_PATCH_MISMATCH';
  end if;
  execute replace(source,marker,$body$
    select result || jsonb_build_object(
      'karas_gifts_received', coalesce((
        select jsonb_agg(jsonb_build_object(
          'amount',gift.amount,'message',gift.message,'redeemed_at',receipt.redeemed_at
        ) order by receipt.redeemed_at,receipt.code_hash)
        from public.karas_gift_redemptions receipt
        join public.karas_gift_codes gift on gift.code_hash=receipt.code_hash
        where receipt.recipient_id=p_user_id
      ),'[]'::jsonb)
    ) into result;
    if (select coalesce(sum(case when jsonb_typeof(value)='array' then jsonb_array_length(value)
        when jsonb_typeof(value)='object' then 1 else 0 end),0) from jsonb_each(result)) > 100000
      or octet_length(result::text) > 26214400 then raise exception 'EXPORT_TOO_LARGE'; end if;
    return result;
  $body$);
end;
$export$;

notify pgrst,'reload schema';
commit;
