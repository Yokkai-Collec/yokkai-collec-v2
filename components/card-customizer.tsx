"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui";
import {
  CARD_COSMETIC_DISPLAY,
  CARD_COSMETIC_COLOR_ORDER,
  canEquipCardCosmetic,
  cardCosmeticEligibility,
  cosmeticNameId,
  cosmeticOfferAnchor,
  type CardCosmeticColorFamily,
  type CardCosmeticInventory,
  type PerCardCosmeticKind,
  type CardCosmeticShop
} from "@/lib/ui/card-cosmetics";
import { createClient } from "@/utils/supabase/client";
import type { Rarity } from "@/lib/data/cards";
import "@/styles/card-customize.css";

type Feedback = "saved" | "copiesExhausted" | "equipFailed";
type Choice = { kind: PerCardCosmeticKind; id: string | null };
type Variant = {
  id: string;
  cosmetic: (typeof CARD_COSMETIC_DISPLAY)[string] & {
    kind: PerCardCosmeticKind;
  };
  color?: string;
};
const HIDDEN_CUSTOMIZATION_EFFECTS = new Set([
  "prism_sweep",
  "ember_aura",
  "showcase_velvet",
  "showcase_mist"
]);

export function CardCustomizer({
  instanceId,
  inventory,
  offers,
  rarity,
  isEvolved,
  equippedFilterId,
  onViewEquipped,
  onInventory,
  onPreview,
  onBack
}: {
  instanceId: string;
  inventory: CardCosmeticInventory | null;
  offers: CardCosmeticShop["items"];
  rarity: Rarity;
  isEvolved: boolean;
  equippedFilterId?: string;
  onViewEquipped: (id: string) => void;
  onInventory: (inventory: CardCosmeticInventory) => void;
  onPreview: (choice: Choice | undefined) => void;
  onBack: () => void;
}) {
  const t = useTranslations("cosmeticShop");
  const [finishes, setFinishes] = useState<
    Partial<Record<CardCosmeticColorFamily, string>>
  >({});
  const copies = inventory?.copies;
  const equipped = inventory?.equipped[instanceId];
  const [draft, setDraft] = useState<Choice>();
  const [feedback, setFeedback] = useState<Feedback>();
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, []);
  const kind = draft?.kind ?? "animation";
  const current = equipped?.[kind] ?? null;
  const chosen = draft ? draft.id : current;
  const selectedCopies = chosen ? (copies?.[chosen]?.available ?? 0) : 0;
  const allCopiesEquipped = Boolean(
    chosen && copies?.[chosen]?.quantity && selectedCopies === 0
  );
  const removableKind = equippedFilterId
    ? (Object.entries(equipped ?? {}).find(
        ([, id]) => id === equippedFilterId
      )?.[0] as PerCardCosmeticKind | undefined)
    : undefined;
  const changed = chosen !== current;
  const eligible = canEquipCardCosmetic(chosen, rarity, isEvolved);
  const canApply =
    Boolean(copies) &&
    changed &&
    eligible &&
    (chosen === null || selectedCopies > 0);
  const onSale = new Set(offers.map(offer => offer.id));
  const toShop =
    changed && chosen && eligible && onSale.has(chosen) && selectedCopies === 0
      ? `/shop?cosmetic=${encodeURIComponent(chosen)}#${cosmeticOfferAnchor(chosen)}`
      : undefined;
  const products = Object.entries(CARD_COSMETIC_DISPLAY)
    .filter(
      ([id, cosmetic]) =>
        !HIDDEN_CUSTOMIZATION_EFFECTS.has(id) &&
        (!cosmetic.infinityRarity || cosmetic.infinityRarity === rarity) &&
        ((cosmetic.kind === "animation" && (copies?.[id] || onSale.has(id))) ||
          (cosmetic.kind === "filter" && copies?.[id])) &&
        t.has(`items.${cosmeticNameId(id)}`)
    )
    .sort(
      ([a], [b]) => Number(Boolean(copies?.[b])) - Number(Boolean(copies?.[a]))
    );
  const groups = new Map<
    string,
    { family?: CardCosmeticColorFamily; variants: Variant[] }
  >();
  for (const [id, cosmetic] of products) {
    const kind = cosmetic.kind;
    if (kind === "back") continue;
    const family = cosmetic.reflectionColor
      ? "reflection"
      : cosmetic.lightningColor
        ? "lightning"
        : undefined;
    const key = family ?? id;
    const variant = {
      id,
      cosmetic: { ...cosmetic, kind },
      color: cosmetic.reflectionColor ?? cosmetic.lightningColor
    };
    const group = groups.get(key);
    if (group) group.variants.push(variant);
    else groups.set(key, { family, variants: [variant] });
  }
  const tiles = Array.from(groups).sort(
    ([, a], [, b]) => Number(Boolean(b.family)) - Number(Boolean(a.family))
  );

  function choose(kind: PerCardCosmeticKind, id: string | null) {
    const choice = { kind, id };
    setDraft(choice);
    onPreview(choice);
    setFeedback(undefined);
  }

  async function apply() {
    if (!canApply || saving.current) return;
    saving.current = true;
    setBusy(true);
    setFeedback(undefined);
    const db = createClient();
    try {
      const { data, error } = await db.rpc("set_card_cosmetic", {
        p_card_id: instanceId,
        p_kind: kind,
        p_cosmetic_id: chosen
      });
      if (!error && data) {
        onInventory(data as CardCosmeticInventory);
        onPreview(undefined);
        setFeedback("saved");
      } else if (error?.message === "COSMETIC_COPIES_EXHAUSTED") {
        setFeedback("copiesExhausted");
        const fresh = await db.rpc("get_my_card_cosmetics");
        if (!fresh.error && fresh.data) {
          onInventory(fresh.data as CardCosmeticInventory);
        }
      } else {
        setFeedback("equipFailed");
      }
    } catch {
      setFeedback("equipFailed");
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }

  return (
    <section
      className="yk-customize-panel"
      aria-label={t("customize")}
      aria-busy={busy}
    >
      <header>
        <h3 ref={heading} tabIndex={-1}>
          {t("customize")}
        </h3>
        <p>{t("tryCosmetics")}</p>
      </header>
      {copies ? (
        <>
          <div className="yk-customize-toolbar">
            <button
              type="button"
              className="yk-customize-default"
              aria-pressed={chosen === null}
              disabled={busy}
              onClick={() => choose(kind, null)}
            >
              {t("defaultLook")}
            </button>
            {removableKind && (
              <button
                type="button"
                className="yk-customize-default"
                disabled={busy}
                onClick={() => choose(removableKind, null)}
              >
                {t("removeEquippedEffect")}
              </button>
            )}
          </div>
          <div className="yk-customize-options">
            {tiles.map(([key, { family, variants }]) => {
              const equippedVariant = variants.find(
                item => item.id === equipped?.[item.cosmetic.kind]
              );
              const variant =
                (!draft ? equippedVariant : undefined) ??
                variants.find(item => item.id === draft?.id) ??
                variants.find(
                  item => item.id === (family && finishes[family])
                ) ??
                equippedVariant ??
                variants.find(item => copies[item.id]?.available > 0) ??
                variants[0];
              const { id, cosmetic, color } = variant;
              const applied = id === equipped?.[cosmetic.kind];
              const stock = copies[id];
              const compatible = canEquipCardCosmetic(id, rarity, isEvolved);
              const active = draft ? chosen === id : applied;
              const name = family
                ? t(`families.${family}`)
                : t(`items.${cosmeticNameId(id)}`);
              const label = cosmetic.infinityRarity
                ? t("cosmeticWithRarity", {
                    name,
                    rarity: cosmetic.infinityRarity
                  })
                : name;
              const attributes = {
                "data-cosmetic": id,
                "data-scene": cosmetic.showcaseScene,
                "data-treatment": family,
                "data-color": color
              };
              const status = applied
                ? t("equippedOnCard")
                : !compatible
                  ? t(cardCosmeticEligibility(id))
                  : !stock
                    ? t("notOwned")
                    : t("availableCopies", { count: stock.available });
              const tile = (
                <>
                  <span className="yk-customize-thumb" aria-hidden="true" />
                  <strong>{label}</strong>
                </>
              );
              if (!family) {
                return (
                  <button
                    type="button"
                    key={key}
                    className="yk-customize-option yk-showcase-scene-choice"
                    {...attributes}
                    aria-pressed={active}
                    disabled={busy}
                    onClick={() => choose(cosmetic.kind, id)}
                  >
                    {tile}
                    <small>{status}</small>
                  </button>
                );
              }
              return (
                <div
                  key={key}
                  className="yk-customize-option yk-customize-color-group"
                  {...attributes}
                  data-selected={active || undefined}
                >
                  <button
                    className="yk-customize-color-preview"
                    type="button"
                    aria-pressed={active}
                    disabled={busy}
                    onClick={() => choose(cosmetic.kind, id)}
                  >
                    {tile}
                  </button>
                  <div
                    className="yk-customize-swatches"
                    role="group"
                    aria-label={t("chooseColor", { name: label })}
                  >
                    {[...variants]
                      .sort(
                        (a, b) =>
                          CARD_COSMETIC_COLOR_ORDER.indexOf(a.color ?? "") -
                          CARD_COSMETIC_COLOR_ORDER.indexOf(b.color ?? "")
                      )
                      .map(option => {
                        const colorLabel = t(`colors.${option.color}`);
                        return (
                          <button
                            type="button"
                            key={option.id}
                            className="yk-customize-swatch"
                            aria-label={colorLabel}
                            title={colorLabel}
                            data-color={option.color}
                            aria-pressed={option.id === id}
                            disabled={busy}
                            onClick={() => {
                              setFinishes(value => ({
                                ...value,
                                [family]: option.id
                              }));
                              choose(option.cosmetic.kind, option.id);
                            }}
                          >
                            <span aria-hidden="true" />
                          </button>
                        );
                      })}
                  </div>
                  <div
                    className="yk-customize-palette-caption"
                    aria-live="polite"
                  >
                    <span>{t(`colors.${color}`)}</span>
                    <small>{status}</small>
                  </div>
                </div>
              );
            })}
          </div>
          {products.length === 0 && (
            <Link className="yk-customize-shop-link" href="/shop">
              {t("findCosmetics")}
            </Link>
          )}
        </>
      ) : (
        <p role="alert">{t("inventoryUnavailable")}</p>
      )}
      <div className="yk-customize-actions">
        <p aria-live="polite">
          {feedback
            ? t(feedback)
            : changed && chosen && !eligible
              ? t(cardCosmeticEligibility(chosen))
              : changed && chosen && !copies?.[chosen]
                ? t("notOwned")
                : changed && chosen && selectedCopies === 0
                  ? t("copiesExhausted")
                  : changed
                    ? t("previewOnly")
                    : null}
        </p>
        {changed && allCopiesEquipped && chosen && (
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => onViewEquipped(chosen)}
          >
            {t("viewEquippedCards")}
          </Button>
        )}
        <Button variant="secondary" onClick={onBack} disabled={busy}>
          {t("backToCardDetails")}
        </Button>
        {toShop ? (
          <Link className="yk-button yk-button-primary" href={toShop}>
            {t("buyInShop")}
          </Link>
        ) : (
          <Button onClick={() => void apply()} disabled={!canApply || busy}>
            {t(busy ? "applyingCosmetic" : "applyCosmetic")}
          </Button>
        )}
      </div>
    </section>
  );
}
