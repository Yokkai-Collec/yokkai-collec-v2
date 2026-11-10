"use client";

import { createClient } from "@/utils/supabase/client";

export type FirstLrCopySource = "legacy" | "mint";
type Entry = { source: FirstLrCopySource | null; expires: number };
const cache = new Map<string, Entry>();
const pending = new Set<string>();
const inFlight = new Set<string>();
const listeners = new Map<string, Set<() => void>>();
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
let scheduled = false;
let unavailableUntil = 0;

export function firstLrCopySource(ids: readonly string[]): FirstLrCopySource | undefined {
  for (const id of ids) {
    const entry = cache.get(id);
    if (entry && entry.expires > Date.now() && entry.source) return entry.source;
  }
  return undefined;
}

export function subscribeFirstLrCopies(ids: readonly string[], listener: () => void) {
  for (const id of ids) {
    const existing = listeners.get(id) ?? new Set();
    existing.add(listener);
    listeners.set(id, existing);
  }
  return () => {
    for (const id of ids) {
      const existing = listeners.get(id);
      existing?.delete(listener);
      if (!existing?.size) listeners.delete(id);
    }
  };
}

async function flush() {
  scheduled = false;
  const ids = [...pending];
  pending.clear();
  for (const id of ids) inFlight.add(id);
  for (let start = 0; start < ids.length; start += 500) {
    const batch = ids.slice(start, start + 500);
    const result = new Map<string, FirstLrCopySource>();
    try {
      const { data, error } = await createClient().rpc("get_first_lr_copy_badges", { p_instance_ids: batch });
      if (error?.code === "PGRST202") unavailableUntil = Date.now() + 60_000;
      if (!error && Array.isArray(data)) {
        const requested = new Set(batch);
        for (const entry of data) {
          if (requested.has(entry.instanceId) && (entry.source === "legacy" || entry.source === "mint")) result.set(entry.instanceId, entry.source);
        }
      }
    } catch {
      // An unavailable optional badge lookup must never break card rendering.
    }
    const notify = new Set<() => void>();
    for (const id of batch) {
      const source = result.get(id) ?? null;
      cache.set(id, { source, expires: source ? Number.POSITIVE_INFINITY : Date.now() + 60_000 });
      inFlight.delete(id);
      for (const listener of listeners.get(id) ?? []) notify.add(listener);
    }
    for (const listener of notify) listener();
  }
}

export function requestFirstLrCopies(ids: readonly string[]) {
  if (Date.now() < unavailableUntil) return;
  for (const id of ids) {
    if (uuid.test(id) && !inFlight.has(id) && (cache.get(id)?.expires ?? 0) <= Date.now()) pending.add(id);
  }
  if (pending.size && !scheduled) {
    scheduled = true;
    setTimeout(() => void flush(), 0);
  }
}
