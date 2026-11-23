"use client";
import { useEffect, useMemo, useState } from "react";
import {
  PrioritySession,
  useBoostersLoadPriority
} from "@/components/boosters-load-priority";
import { Game, gameReads } from "@/components/game";
import {
  readRequest,
  resumePages,
  type PageCheckpoint
} from "@/lib/data/read-request";
import { createPlayerSnapshotCache } from "@/lib/data/player-state";
import { useNotificationFeed } from "@/hooks/use-notification-feed";
import type { CollectedCard } from "@/lib/data/cards";
const options = [
  { label: "0 ms", value: 0 },
  { label: "800 ms", value: 800 },
  { label: "3 s", value: 3000 },
  { label: "Ne répond jamais", value: -1 }
];
const fixture: CollectedCard = {
  id: "proof-card",
  instanceId: "proof-instance",
  name: "Carte déjà possédée",
  rarity: "C",
  category: "Anime",
  image: "/assets/booster-pack.png",
  catalogueImage: "/assets/booster-pack.png",
  customImageUrl: null,
  obtainedAt: "2026-01-01",
  shiny: false,
  isEvolved: false,
  isFirstOwner: true,
  folderId: null
};
type Settings = {
  statusDelay: number;
  decisionDelay: number;
  collectionDelay: number;
  infoDelay: number;
  notificationDelay: number;
  old: boolean;
};
function createPreviewData(
  {
    old,
    infoDelay,
    collectionDelay,
    statusDelay,
    decisionDelay,
    notificationDelay
  }: Settings,
  setEvents: (update: (current: string[]) => string[]) => void,
  setCalls: (
    update: (current: Record<string, number>) => Record<string, number>
  ) => void,
  setDuplicates: (update: (current: number) => number) => void
) {
  let collectionLatency = collectionDelay;
  let statusLatency = statusDelay;
  let decisionLatency = decisionDelay;
  let infoLatency = infoDelay;
  let notificationsLatency = notificationDelay;
  const cache = createPlayerSnapshotCache();
  const active = new Set<string>();
  let started = 0;
  const checkpoint: PageCheckpoint<CollectedCard & { id: string }> = {
    rows: []
  };
  async function request<T>(
    name: string,
    latency: number,
    result: T
  ): Promise<T> {
    started ||= Date.now();
    if (active.has(name)) setDuplicates(value => value + 1);
    active.add(name);
    setCalls(current => ({ ...current, [name]: (current[name] ?? 0) + 1 }));
    setEvents(current => [
      ...current,
      `${Date.now() - started} ms · ${name} lancé`
    ]);
    const wait = (signal?: AbortSignal) =>
      new Promise<T>((resolve, reject) => {
        const timer =
          latency < 0 ? undefined : setTimeout(() => resolve(result), latency);
        signal?.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            reject(new Error("Requête annulée"));
          },
          { once: true }
        );
      });
    try {
      return await (old ? wait() : readRequest(signal => wait(signal)));
    } finally {
      active.delete(name);
      setEvents(current => [
        ...current,
        `${Date.now() - started} ms · ${name} terminé`
      ]);
    }
  }
  const reads: typeof gameReads = {
    getPackStatus: () =>
      cache.memo("regular", 0, () =>
        request("get_regular_pack_status", statusLatency, {
          available: 3,
          maximum: 5,
          nextPackAt: null
        })
      ),
    getDecisionPackStatus: () =>
      cache.memo("decision", 0, () =>
        request("get_decision_pack_status", decisionLatency, {
          available: true,
          nextPackAt: Date.now() + 86400000,
          pending: []
        })
      ),
    getGameInfo: () =>
      cache.memo("info", 60000, () =>
        request("get_game_info", infoLatency, {
          user: { id: "proof", name: "Kitsune" },
          karasBalance: 4920,
          categories: [],
          rarities: [],
          dropRates: [],
          shinyRate: 0.5
        })
      ),
    getUserCollection: () =>
      cache.memo("collection", 10000, async () => {
        // Two rows per page in this fixture; page 2 can fail independently.
        const rows = await resumePages(checkpoint, 2, cursor =>
          request(
            `user_cards page ${cursor ? 2 : 1}`,
            cursor ? collectionLatency : 0,
            cursor
              ? [{ ...fixture, id: "proof-card-3", instanceId: "proof-3" }]
              : [
                  fixture,
                  { ...fixture, id: "proof-card-2", instanceId: "proof-2" }
                ]
          )
        );
        return rows;
      }),
    getFolders: () => cache.memo("folders", 0, () => request("folders", 0, [])),
    getActiveAuctionCards: () =>
      cache.memo("auctions", 0, () =>
        request("get_my_active_auction_cards", 0, [])
      )
  };
  let barrier: Promise<unknown[]> | undefined;
  const names = Object.keys(reads) as (keyof typeof reads)[];
  const oldReads = Object.fromEntries(
    names.map((name, index) => [
      name,
      () => {
        barrier ??= Promise.all(names.map(key => reads[key]()));
        return barrier.then(results => results[index]);
      }
    ])
  ) as typeof gameReads;
  return {
    setCollectionDelay: (value: number) => {
      collectionLatency = value;
    },
    setStatusDelay: (value: number) => {
      statusLatency = value;
      decisionLatency = value;
    },
    setInfoDelay: (value: number) => {
      infoLatency = value;
    },
    setNotificationsDelay: (value: number) => {
      notificationsLatency = value;
    },
    secondary: () =>
      Promise.all([
        request("get_profile", 0, null),
        request("is_current_user_admin", 0, false),
        request("touch_presence", 0, true)
      ]),
    reads: old ? oldReads : reads,
    notifications: () =>
      cache.memo("notifications", 0, () =>
        request("list_notifications", notificationsLatency, [])
      )
  };
}
function Run({
  statusDelay,
  decisionDelay,
  collectionDelay,
  infoDelay,
  notificationDelay,
  old
}: {
  statusDelay: number;
  decisionDelay: number;
  collectionDelay: number;
  infoDelay: number;
  notificationDelay: number;
  old: boolean;
}) {
  const [events, setEvents] = useState<string[]>([]);
  const [calls, setCalls] = useState<Record<string, number>>({});
  const [duplicates, setDuplicates] = useState(0);
  const [retryCollectionDelay, setRetryCollectionDelay] =
    useState(collectionDelay);
  const [retryStatusDelay, setRetryStatusDelay] = useState(statusDelay);
  const [retryInfoDelay, setRetryInfoDelay] = useState(infoDelay);
  const [retryNotificationsDelay, setRetryNotificationsDelay] =
    useState(notificationDelay);
  // Mutable latency controls affect only the next request; already pending reads remain pending.
  const data = useMemo(
    () =>
      createPreviewData(
        {
          old,
          infoDelay,
          collectionDelay,
          statusDelay,
          decisionDelay,
          notificationDelay
        },
        setEvents,
        setCalls,
        setDuplicates
      ),
    [
      old,
      infoDelay,
      collectionDelay,
      statusDelay,
      decisionDelay,
      notificationDelay
    ]
  );
  const ready = useBoostersLoadPriority() >= 2;
  const feed = useNotificationFeed(ready, data.notifications);
  useEffect(() => {
    if (ready) void data.secondary();
  }, [ready, data]);
  return (
    <>
      <div className="my-4 flex flex-wrap gap-4">
        <label>
          Prochaine page collection{" "}
          <select
            aria-label="Prochaine page collection"
            value={retryCollectionDelay}
            onChange={event => {
              const value = Number(event.target.value);
              data.setCollectionDelay(value);
              setRetryCollectionDelay(value);
            }}
          >
            {options.map(option => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Prochains statuts{" "}
          <select
            aria-label="Prochains statuts"
            value={retryStatusDelay}
            onChange={event => {
              const value = Number(event.target.value);
              data.setStatusDelay(value);
              setRetryStatusDelay(value);
            }}
          >
            {options.map(option => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Prochaines infos joueur{" "}
          <select
            aria-label="Prochaines infos joueur"
            value={retryInfoDelay}
            onChange={event => {
              const value = Number(event.target.value);
              data.setInfoDelay(value);
              setRetryInfoDelay(value);
            }}
          >
            {options.map(option => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Prochaines notifications{" "}
          <select
            aria-label="Prochaines notifications"
            value={retryNotificationsDelay}
            onChange={event => {
              const value = Number(event.target.value);
              data.setNotificationsDelay(value);
              setRetryNotificationsDelay(value);
            }}
          >
            {options.map(option => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p data-proof="duplicates">Appels simultanés en double : {duplicates}</p>
      <pre data-proof="calls">{JSON.stringify(calls, null, 2)}</pre>
      <section data-proof="notifications">
        {feed.error ? (
          <p role="alert">
            {feed.error} <button onClick={feed.retry}>Réessayer</button>
          </p>
        ) : feed.notifications ? (
          "Notifications chargées"
        ) : (
          "Chargement des notifications…"
        )}
      </section>
      <Game view="packs" previewData={data.reads} />
      <details open>
        <summary>Chronologie des requêtes simulées</summary>
        <ol data-proof="events">
          {events.map((event, index) => (
            <li key={index}>{event}</li>
          ))}
        </ol>
      </details>
    </>
  );
}
export function BoostersLoadPreview() {
  const [settings, setSettings] = useState({
    statusDelay: 800,
    decisionDelay: 800,
    collectionDelay: 3000,
    infoDelay: 0,
    notificationDelay: 0,
    old: false
  });
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    queueMicrotask(() => setMounted(true));
  }, []);
  const [run, setRun] = useState(0);
  const [running, setRunning] = useState(settings);
  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <h1 className="text-2xl">Résilience du chargement Boosters</h1>
      <p className="my-4">
        Données locales simulées. Aucune ouverture réelle. Délai par requête :
        15 s. La page 1 de collection est immédiate ; la latence contrôle la
        page 2.
      </p>
      <div className="flex flex-wrap gap-4">
        {(
          [
            "statusDelay",
            "decisionDelay",
            "collectionDelay",
            "infoDelay",
            "notificationDelay"
          ] as const
        ).map(key => (
          <label key={key}>
            {key === "statusDelay"
              ? "Régulier"
              : key === "decisionDelay"
                ? "Décisif"
                : key === "collectionDelay"
                  ? "Collection"
                  : key === "infoDelay"
                    ? "Infos joueur"
                    : "Notifications"}{" "}
            <select
              aria-label={key}
              value={settings[key]}
              onChange={event =>
                setSettings(current => ({
                  ...current,
                  [key]: Number(event.target.value)
                }))
              }
            >
              {options.map(option => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        ))}
        <label>
          <input
            type="checkbox"
            aria-label="Ancien comportement"
            checked={settings.old}
            onChange={event =>
              setSettings(current => ({
                ...current,
                old: event.target.checked
              }))
            }
          />{" "}
          Ancien comportement : attend tout, sans délai maximal
        </label>
        <button
          data-proof="start"
          disabled={!mounted}
          className="yk-button yk-button-primary"
          onClick={() => {
            setRunning(settings);
            setRun(value => value + 1);
          }}
        >
          Lancer la simulation
        </button>
      </div>
      <PrioritySession key={run} pathname="/boosters">
        <Run {...running} />
      </PrioritySession>
    </main>
  );
}
