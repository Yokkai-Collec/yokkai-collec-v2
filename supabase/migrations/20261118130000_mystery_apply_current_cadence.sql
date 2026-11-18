begin;
set local lock_timeout='5s';
-- The new cadence is announced: advance the remaining legacy edition to its
-- local 11:00 boundary. Never postpone an earlier deadline or touch escrow,
-- bids, draw probabilities, cards or completed editions. Existing minute cron
-- settles it if overdue; the creator then opens the next available slot.
update public.auctions
set duration_minutes=900,
    ends_at=least(ends_at,((mystery_day+1)+time '11:00') at time zone 'Europe/Paris')
where is_mystery and status='active' and mystery_slot=20
  and duration_minutes in (1380,1440);
notify pgrst,'reload schema';
commit;
