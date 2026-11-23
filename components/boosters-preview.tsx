"use client";

import { useState } from "react";
import { Boosters, type RevealCard } from "@/components/boosters";
import {
  blackoutPreviewEnabled,
  openBlackoutPreview
} from "@/lib/data/blackout-preview";
import type { BoosterKind } from "@/lib/ui/booster-opening-document";
import type { Rarity } from "@/lib/data/cards";

// Local-only simulation: no RPC, so the complete opening flow (including SSR/LR
// reveals) can be exercised in a browser without consuming a real pack.
const draws: Record<"regular" | "decision", [string, Rarity, boolean?][]> = {
  regular: [
    ["Kappa ancien", "C"],
    ["Tanuki solaire", "R"],
    ["Tengu des brumes", "SR"],
    ["Oni écarlate", "SSR"],
    ["Kitsune céleste", "LR"]
  ],
  decision: [
    ["Kappa ancien", "R"],
    ["Tengu des brumes", "SR"],
    ["Yuki-Onna", "SR"],
    ["Oni écarlate", "SSR", true],
    ["Tanuki solaire", "SR"]
  ]
};
const franchises = [
  "Spirit Realm",
  "Mononoke Chronicles",
  "Hyakki Yagyō",
  "Spirit Realm",
  "Moonlit Shrine"
];

export function BoostersPreview({
  pityOpened,
  showPackChoices = false
}: {
  pityOpened?: number;
  showPackChoices?: boolean;
} = {}) {
  const [draw, setDraw] = useState<RevealCard[]>([]);
  const [drawKind, setDrawKind] = useState<BoosterKind>("regular");
  const [revealed, setRevealed] = useState(0);
  const [reserve, setReserve] = useState(10);
  const [decisionUsed, setDecisionUsed] = useState(false);
  const [decisionReturn] = useState(() => new Date().setHours(24, 0, 0, 0));
  async function openDemo(kind: "regular" | "decision", count = 1) {
    if (kind === "regular") {
      if (reserve < count) return;
      setReserve(current => current - count);
    } else {
      setDecisionUsed(true);
    }
    const stamp = Date.now();
    const cards = Array.from({ length: count }, (_, pack) =>
      draws[kind].map(([name, rarity, shiny], index) => ({
        id: "preview-" + kind + "-" + index,
        instanceId: ["preview", kind, stamp, pack, index].join("-"),
        name,
        category: "Anime",
        anime: franchises[index],
        rarity,
        image: "/assets/booster-pack.png",
        shiny
      }))
    ).flat();
    setDrawKind(kind);
    setRevealed(0);
    setDraw(cards);
    return cards;
  }

  return (
    <Boosters
      pityPreviewOpened={pityOpened}
      referralPreviewCode={showPackChoices ? "000000000000" : undefined}
      previewOnly={blackoutPreviewEnabled}
      clickToOpen={blackoutPreviewEnabled}
      onOpenBlackout={
        blackoutPreviewEnabled
          ? async () => {
              const cards = await openBlackoutPreview();
              setDraw(cards);
              setDrawKind("blackout");
              setRevealed(0);
              return cards;
            }
          : undefined
      }
      status={{
        available: reserve,
        maximum: 10,
        nextPackAt: reserve === 10 ? null : 4_102_444_800_000
      }}
      countdown="42:00"
      // Demo probabilities only; the live page gets these from the server.
      dropRates={[
        { rarity: "C", percent: 69.4 },
        { rarity: "R", percent: 20 },
        { rarity: "SR", percent: 10 },
        { rarity: "SSR", percent: 0.5 },
        { rarity: "LR", percent: 0.1 }
      ]}
      decisionDropRates={[
        { rarity: "SR", percent: 96.5 },
        { rarity: "SSR", percent: 3 },
        { rarity: "LR", percent: 0.5 }
      ]}
      shinyRate={0.5}
      decisionStatus={{
        available: !decisionUsed,
        maximum: 1,
        remaining: decisionUsed ? 0 : 1,
        pending: [],
        nextPackAt: decisionReturn
      }}
      decisionCountdown="08:00:00"
      busy={false}
      draw={draw}
      drawKind={drawKind}
      collection={[]}
      revealed={revealed}
      onOpen={kind => openDemo(kind)}
      onOpenMany={count => openDemo("regular", count)}
      onKeepDecision={async () => 180}
      onDiscard={async () => {}}
      onReveal={index =>
        setRevealed(current => (current === index ? current + 1 : current))
      }
    />
  );
}
