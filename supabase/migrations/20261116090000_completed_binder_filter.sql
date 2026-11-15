begin;

-- Keep the existing RPC signatures for older clients and profile views.
-- Reuse the binder queries, including their permission checks and ordering.
do $patch$
declare
  source text;
  changed text;
begin
  source := pg_get_functiondef('public.get_binder_albums_page(uuid,text,text,boolean,integer,integer)'::regprocedure);
  changed := replace(source,
    'where not coalesce(p_favorites_only,false) or favorite)',
    'where (not coalesce(p_favorites_only,false) or favorite)
        and (p_completed_only is not true or (total > 0 and owned = total)))');
  if changed = source then raise exception 'COMPLETED_BINDER_FILTER_ANCHOR_MISSING'; end if;

  -- Completion is measured against the whole binder, as in the leaderboard.
  changed := replace(changed, 'coalesce(p_category,'''')',
    'case when p_completed_only then '''' else coalesce(p_category,'''') end');
  execute regexp_replace(changed, '^CREATE OR REPLACE FUNCTION [^(]+\([^\r\n]*\)',
    'CREATE OR REPLACE FUNCTION public.get_binder_albums_page(p_owner_id uuid, p_query text, p_category text, p_favorites_only boolean, p_offset integer, p_limit integer, p_completed_only boolean)');

  source := pg_get_functiondef('public.get_panini_albums_page(text,text,integer,integer,boolean)'::regprocedure);
  changed := replace(source,
    'where not coalesce(p_favorites_only, false) or progress.favorite',
    'where (not coalesce(p_favorites_only, false) or progress.favorite)
        and (p_completed_only is not true or (progress.total > 0 and progress.owned = progress.total))');
  if changed = source then raise exception 'COMPLETED_PANINI_FILTER_ANCHOR_MISSING'; end if;

  changed := replace(changed, 'coalesce(p_category, '''')',
    'case when p_completed_only then '''' else coalesce(p_category, '''') end');
  execute regexp_replace(changed, '^CREATE OR REPLACE FUNCTION [^(]+\([^\r\n]*\)',
    'CREATE OR REPLACE FUNCTION public.get_panini_albums_page(p_query text, p_category text, p_offset integer, p_limit integer, p_favorites_only boolean, p_completed_only boolean)');
end;
$patch$;

revoke all on function public.get_binder_albums_page(uuid,text,text,boolean,integer,integer,boolean),
  public.get_panini_albums_page(text,text,integer,integer,boolean,boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.get_binder_albums_page(uuid,text,text,boolean,integer,integer,boolean),
  public.get_panini_albums_page(text,text,integer,integer,boolean,boolean) to authenticated;

notify pgrst, 'reload schema';
commit;
