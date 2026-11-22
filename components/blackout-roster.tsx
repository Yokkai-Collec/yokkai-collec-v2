"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { CardShell } from "@/components/card-shell";
import { CatalogueCardModal } from "@/components/catalogue-card-modal";
import { YokaiCard } from "@/components/yokai-card";
import { blackoutCards } from "@/lib/data/blackout-preview";
import type { Card } from "@/lib/data/cards";
import { getCardDiscovery } from "@/lib/data/wishlist";
import { createClient } from "@/utils/supabase/client";

async function loadBlackoutOwners(card: Card, offset: number) {
  const { data, error } = await createClient()
    .from("cards")
    .select("id")
    .eq("source", "manual")
    .eq("source_id", card.id)
    .eq("event_only", true)
    .eq("rarete_base", "LR")
    .maybeSingle();

  if (error) throw new Error("catalogueUi.ownersUnavailable");
  if (!data) return { owners: [], ownerCount: 0 };
  const { owners, ownerCount } = await getCardDiscovery(data.id, offset);
  return { owners, ownerCount };
}

export function BlackoutRoster() {
  const t = useTranslations("blackout");
  const catalogue = useTranslations("catalogueUi");
  const [selected, setSelected] = useState<Card | null>(null);

  return (
    <section
      className="yk-blackout-roster"
      aria-labelledby="blackout-roster-title"
    >
      <h2 id="blackout-roster-title" className="font-display text-xl font-bold">
        {t("roster")}
      </h2>
      <ul>
        {blackoutCards.map(card => (
          <li key={card.id}>
            <button
              className="yk-catalogue-card"
              type="button"
              aria-haspopup="dialog"
              aria-label={catalogue("viewCard", {
                name: card.name,
                rarity: card.rarity
              })}
              onClick={() => setSelected(card)}
            >
              <CardShell>
                <YokaiCard {...card} />
              </CardShell>
            </button>
          </li>
        ))}
      </ul>
      <CatalogueCardModal
        selected={selected}
        onClose={() => setSelected(null)}
        loadOwners={loadBlackoutOwners}
      />
    </section>
  );
}
