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

export function BoostersPreview() {
  const [draw, setDraw] = useState<RevealCard[]>([]);
  const [drawKind, setDrawKind] = useState<BoosterKind>("regular");
  const [revealed, setRevealed] = useState(0);
  const [reserve, setReserve] = useState(3);
  const [decisionUsed, setDecisionUsed] = useState(false);
  const [decisionReturn] = useState(() => new Date().setHours(24, 0, 0, 0));
  return (
    <Boosters
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
      status={{ available: reserve, maximum: 5, nextPackAt: 4_102_444_800_000 }}
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
      shinyRate={1}
      decisionStatus={{
        available: !decisionUsed,
        pending: [],
        nextPackAt: decisionReturn
      }}
      decisionCountdown="08:00:00"
      busy={false}
      draw={draw}
      drawKind={drawKind}
      collection={[]}
      revealed={revealed}
      onOpen={async kind => {
        if (kind === "regular") setReserve(current => Math.max(0, current - 1));
        else setDecisionUsed(true);
        setDrawKind(kind);
        setRevealed(0);
        const cards = draws[kind].map(([name, rarity, shiny], index) => ({
          id: `preview-${kind}-${index}`,
          instanceId: `preview-${kind}-${index}-${Date.now()}`,
          name,
          category: "Anime",
          anime: franchises[index],
          rarity,
          image: "/assets/booster-pack.png",
          shiny
        }));
        setDraw(cards);
        return cards;
      }}
      onKeepDecision={async () => 180}
      onDiscard={async () => {}}
      onReveal={index =>
        setRevealed(current => (current === index ? current + 1 : current))
      }
    />
  );
}
