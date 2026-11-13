import { useEffect, useMemo, useState } from "react";
import type {
  CollectionCounts,
  CollectionPage,
  CollectionPagesAdapter,
  ServerCopy
} from "@/lib/data/collection-pages";
import type { CollectionFilters } from "@/lib/ui/collection-filter";

export type CollectionPagesSource = {
  adapter: CollectionPagesAdapter;
  // Bumped after every mutation: pages, counters and copies are read again.
  version: number;
};

// A value stays usable only for the request it answered.
type Keyed<T> = { key: string; value: T };
function pick<T>(state: Keyed<T> | null, key: string, fallback: T) {
  return state?.key === key ? state.value : fallback;
}
// Cursor of each page already reached, per adapter and query (the query
// includes the version, so a mutation starts a new table).
const cursorTables = new WeakMap<object, Map<string, string>>();
function cursors(adapter: object) {
  let table = cursorTables.get(adapter);
  if (!table) cursorTables.set(adapter, (table = new Map()));
  return table;
}

// #388: one page of groups at a time. Next/previous pages use the cursor of
// the page before; a direct jump uses an offset.
export function useCollectionPages(
  source: CollectionPagesSource | undefined,
  {
    filters,
    page,
    pageSize,
    ownedCardIds,
    license
  }: {
    filters: CollectionFilters;
    page: number;
    pageSize: number;
    ownedCardIds: string[];
    license: string | null;
  }
) {
  const adapter = source?.adapter;
  const version = source?.version ?? 0;
  const query = JSON.stringify({ filters, pageSize, version });
  const pageKey = `${query}|${page}`;
  const owned = ownedCardIds.join(",");
  const [result, setResult] = useState<Keyed<CollectionPage> | null>(null);
  const [failure, setFailure] = useState<Keyed<string> | null>(null);
  const [counts, setCounts] = useState<Keyed<CollectionCounts> | null>(null);
  const [ownedCopies, setOwnedCopies] = useState<Keyed<ServerCopy[]> | null>(
    null
  );
  const [licenseCopies, setLicenseCopies] = useState<Keyed<number> | null>(
    null
  );
  // Copies seen since the last mutation, so a selection can span pages.
  const [seen, setSeen] = useState<Keyed<Map<string, ServerCopy>> | null>(null);
  const remember = (copies: ServerCopy[]) =>
    setSeen(current => {
      const next = new Map(
        current?.key === String(version) ? current.value : undefined
      );
      for (const copy of copies) next.set(copy.instanceId, copy);
      return { key: String(version), value: next };
    });

  useEffect(() => {
    if (!adapter) return;
    const table = cursors(adapter);
    const after = page > 1 ? table.get(`${query}|${page}`) : undefined;
    let active = true;
    adapter
      .page(JSON.parse(query).filters, {
        after,
        offset: after ? 0 : (page - 1) * pageSize,
        limit: pageSize
      })
      .then(
        next => {
          if (!active || !next) return;
          if (next.next) table.set(`${query}|${page + 1}`, next.next);
          setResult({ key: pageKey, value: next });
          remember(next.groups.flatMap(group => group.copies));
        },
        error => {
          if (active)
            setFailure({
              key: pageKey,
              value: error instanceof Error ? error.message : "failed"
            });
        }
      );
    return () => {
      active = false;
    };
    // remember only depends on version, already part of query.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adapter, query, page, pageSize, pageKey]);

  useEffect(() => {
    if (!adapter) return;
    let active = true;
    void adapter.counts().then(
      next => {
        if (active && next) setCounts({ key: String(version), value: next });
      },
      () => undefined
    );
    return () => {
      active = false;
    };
  }, [adapter, version]);

  useEffect(() => {
    if (!adapter || !owned) return;
    let active = true;
    void adapter.ownedCopies(owned.split(",")).then(
      next => {
        if (active && next) {
          setOwnedCopies({ key: `${version}|${owned}`, value: next });
          remember(next);
        }
      },
      () => undefined
    );
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adapter, owned, version]);

  useEffect(() => {
    if (!adapter || !license) return;
    let active = true;
    void adapter.licenseCopies(license).then(
      next => {
        if (active && next !== null)
          setLicenseCopies({ key: `${version}|${license}`, value: next });
      },
      () => undefined
    );
    return () => {
      active = false;
    };
  }, [adapter, license, version]);

  const known = useMemo(
    () => pick(seen, String(version), new Map<string, ServerCopy>()),
    [seen, version]
  );
  if (!adapter) return null;
  const current = pick(result, pageKey, null);
  // Never render a page obtained for another filter set while a new search is
  // pending. Keeping it visible made results from the previous query look like
  // they belonged to the newly typed search. We still retain a previous page
  // when only the page number changes, which keeps normal pagination smooth.
  const latestForFilters = result?.key.startsWith(`${query}|`)
    ? result.value
    : null;
  return {
    page: current ?? latestForFilters,
    counts: pick(counts, String(version), counts?.value ?? null),
    ownedCopies: owned ? pick(ownedCopies, `${version}|${owned}`, []) : [],
    licenseCopies: license
      ? pick(licenseCopies, `${version}|${license}`, 0)
      : 0,
    known,
    loading: !current && !pick(failure, pageKey, ""),
    error: pick(failure, pageKey, "")
  };
}

// Every copy of the open group, whatever the filters (detail, evolution).
export function useCollectionGroupCopies(
  source: CollectionPagesSource | undefined,
  key: string | null
) {
  const [copies, setCopies] = useState<Keyed<ServerCopy[]> | null>(null);
  const adapter = source?.adapter;
  const requestKey = `${source?.version ?? 0}|${key}`;
  useEffect(() => {
    if (!adapter || !key) return;
    let active = true;
    void adapter.groupCopies(key).then(
      next => {
        if (active && next) setCopies({ key: requestKey, value: next });
      },
      () => undefined
    );
    return () => {
      active = false;
    };
  }, [adapter, key, requestKey]);
  return pick(copies, requestKey, []);
}
