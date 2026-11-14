import { createClient } from "@/utils/supabase/client";

export type WallMentionPlayer = { userId: string; pseudo: string };

export async function findWallMentionPlayers(
  pseudos: string[],
  prefix = false,
  signal?: AbortSignal
): Promise<WallMentionPlayer[]> {
  const request = createClient().rpc("find_wall_mention_players", {
    p_pseudos: pseudos,
    p_prefix: prefix
  });
  const { data, error } = await (signal ? request.abortSignal(signal) : request);
  if (error || !Array.isArray(data)) return [];
  return data as WallMentionPlayer[];
}

type Lookup = {
  pseudos: string[];
  resolve: (players: WallMentionPlayer[]) => void;
};
let pending: Lookup[] = [];

// A feed can mount many posts together. Resolve their distinct pseudos in
// batches without keeping a cache across account or block changes.
async function flushMentionLookups() {
  const lookups = pending;
  pending = [];
  const pseudos = [...new Set(lookups.flatMap(lookup => lookup.pseudos))];
  const requests = [];
  for (let offset = 0; offset < pseudos.length; offset += 100) {
    requests.push(findWallMentionPlayers(pseudos.slice(offset, offset + 100)));
  }
  const results = await Promise.allSettled(requests);
  const players = new Map(
    results.flatMap(result =>
      result.status === "fulfilled"
        ? result.value.map(player => [player.pseudo.toLowerCase(), player] as const)
        : []
    )
  );
  for (const { pseudos, resolve } of lookups) {
    resolve(pseudos.flatMap(pseudo => players.get(pseudo) ?? []));
  }
}

export function resolveWallMentionPlayers(pseudos: string[]) {
  return new Promise<WallMentionPlayer[]>(resolve => {
    if (pending.length === 0) queueMicrotask(() => void flushMentionLookups());
    pending.push({ pseudos, resolve });
  });
}
