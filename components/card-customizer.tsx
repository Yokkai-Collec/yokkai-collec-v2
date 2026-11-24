"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui";
import { CardBack } from "@/components/yokai-card";
import {
  CARD_COSMETIC_DISPLAY,
  CARD_COSMETIC_COLOR_ORDER,
  cosmeticOfferAnchor,
  type CardCosmeticColorFamily,
  type CardCosmeticInventory,
  type CardCosmeticKind,
  type CardCosmeticShop
} from "@/lib/ui/card-cosmetics";
import { createClient } from "@/utils/supabase/client";
import "@/styles/card-customize.css";

type Feedback = "saved" | "copiesExhausted" | "equipFailed";
type Choice = { kind: CardCosmeticKind; id: string | null };
type Variant = {
  id: string;
  cosmetic: (typeof CARD_COSMETIC_DISPLAY)[string];
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
  lightningEligible,
  onInventory,
  onPreview,
  onBack
}: {
  instanceId: string;
  inventory: CardCosmeticInventory | null;
  offers: CardCosmeticShop["items"];
  lightningEligible: boolean;
  onInventory: (inventory: CardCosmeticInventory) => void;
  onPreview: (choice: Choice | undefined, showBack: boolean) => void;
  onBack: () => void;
}) {
  const t = useTranslations("cosmeticShop");
  const [tab, setTab] = useState<"animation" | "back">("animation");
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
  const kind = draft?.kind ?? tab;
  const current = equipped?.[kind] ?? null;
  const chosen = draft ? draft.id : current;
  const selectedCopies = chosen ? (copies?.[chosen]?.available ?? 0) : 0;
  const changed = chosen !== current;
  const eligible =
    !chosen ||
    !CARD_COSMETIC_DISPLAY[chosen]?.lightningColor ||
    lightningEligible;
  const canApply =
    Boolean(copies) &&
    changed &&
    eligible &&
    (chosen === null || selectedCopies > 0);
  const onSale = new Set(offers.map(offer => offer.id));
  const toShop =
    changed &&
    chosen &&
    onSale.has(chosen) &&
    (!copies?.[chosen] || (eligible && selectedCopies === 0))
      ? `/shop?cosmetic=${encodeURIComponent(chosen)}#${cosmeticOfferAnchor(chosen)}`
      : undefined;
  const products = Object.entries(CARD_COSMETIC_DISPLAY)
    .filter(
      ([id, cosmetic]) =>
        !HIDDEN_CUSTOMIZATION_EFFECTS.has(id) &&
        ((cosmetic.kind === tab && (copies?.[id] || onSale.has(id))) ||
          (tab === "animation" &&
            cosmetic.kind === "filter" &&
            copies?.[id])) &&
        t.has(`items.${id}`)
    )
    .sort(
      ([a], [b]) => Number(Boolean(copies?.[b])) - Number(Boolean(copies?.[a]))
    );
  const groups = new Map<
    string,
    { family?: CardCosmeticColorFamily; variants: Variant[] }
  >();
  for (const [id, cosmetic] of products) {
    const family = cosmetic.reflectionColor
      ? "reflection"
      : cosmetic.lightningColor
        ? "lightning"
        : undefined;
    const key = family ?? id;
    const variant = {
      id,
      cosmetic,
      color: cosmetic.reflectionColor ?? cosmetic.lightningColor
    };
    const group = groups.get(key);
    if (group) group.variants.push(variant);
    else groups.set(key, { family, variants: [variant] });
  }
  const tiles = Array.from(groups).sort(
    ([, a], [, b]) => Number(Boolean(b.family)) - Number(Boolean(a.family))
  );

  function choose(kind: CardCosmeticKind, id: string | null) {
    const choice = { kind, id };
    setDraft(choice);
    onPreview(choice, kind === "back");
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
        onPreview(undefined, kind === "back");
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
            <div
              className="yk-customize-tabs"
              role="group"
              aria-label={t("cosmeticCategories")}
            >
              {(["animation", "back"] as const).map(category => (
                <button
                  key={category}
                  type="button"
                  disabled={busy}
                  aria-pressed={category === tab}
                  onClick={() => {
                    if (category === tab) return;
                    setDraft(undefined);
                    setTab(category);
                    onPreview(undefined, category === "back");
                    setFeedback(undefined);
                  }}
                >
                  {t(`kinds.${category}`)}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="yk-customize-default"
              aria-pressed={chosen === null}
              disabled={busy}
              onClick={() => choose(kind, null)}
            >
              {t("defaultLook")}
            </button>
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
              const compatible = !cosmetic.lightningColor || lightningEligible;
              const active = draft ? chosen === id : applied;
              const label = family ? t(`families.${family}`) : t(`items.${id}`);
              const attributes = {
                "data-cosmetic": id,
                "data-scene": cosmetic.showcaseScene,
                "data-treatment": family,
                "data-color": color
              };
              const status = applied
                ? t("equippedOnCard")
                : !stock
                  ? t("notOwned")
                  : !compatible
                    ? t("specialCardsOnly")
                    : t("availableCopies", { count: stock.available });
              const tile = (
                <>
                  <span className="yk-customize-thumb" aria-hidden="true">
                    {cosmetic.kind === "back" && <CardBack cosmetic={id} />}
                  </span>
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
            : changed && chosen && !copies?.[chosen]
              ? t("notOwned")
              : changed && !eligible
                ? t("lightningEligibility")
                : changed && chosen && selectedCopies === 0
                  ? t("copiesExhausted")
                  : changed
                    ? t("previewOnly")
                    : null}
        </p>
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
