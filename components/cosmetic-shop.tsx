"use client";

import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { useRef, useState, type ReactNode } from "react";
import { setInvocationCardBack } from "@/app/shop/actions";
import { CardBack, YokaiCard } from "@/components/yokai-card";
import { Topbar } from "@/components/topbar";
import { Button, Karas, Modal } from "@/components/ui";
import { invalidatePlayerSnapshots } from "@/lib/data/cards";
import { AUTH_EVOLUTION_CARDS } from "@/lib/auth/showcase-cards";
import {
  CARD_COSMETIC_DISPLAY,
  CARD_COSMETIC_COLOR_ORDER,
  CARD_COSMETIC_ELIGIBILITY,
  CARD_COSMETIC_TIERS,
  cosmeticOfferAnchor,
  replayCardCosmeticColor,
  type CardCosmeticColorFamily,
  type CardCosmeticShop,
  type CardCosmeticTier
} from "@/lib/ui/card-cosmetics";
import { createClient } from "@/utils/supabase/client";

export type CosmeticShopState = CardCosmeticShop;
type CosmeticShopItem = CardCosmeticShop["items"][number];
type ShopView = CardCosmeticTier | "backs";

const defaultFinish = {
  reflection: "infinity_reflection_original",
  lightning: "infinity_lightning"
} satisfies Record<CardCosmeticColorFamily, string>;

function offerColor(item: CosmeticShopItem) {
  const display = CARD_COSMETIC_DISPLAY[item.id];
  return display?.reflectionColor ?? display?.lightningColor;
}

function offerFamily(id: string): CardCosmeticColorFamily | undefined {
  const display = CARD_COSMETIC_DISPLAY[id];
  if (display?.reflectionColor) return "reflection";
  if (display?.lightningColor) return "lightning";
}

function offerEligibility(item: CosmeticShopItem) {
  if (item.kind === "back") return;
  const tier = CARD_COSMETIC_DISPLAY[item.id]?.tier;
  return tier ? CARD_COSMETIC_ELIGIBILITY[tier] : "allCardsEligibility";
}

function CosmeticCardPreview({
  item,
  tier
}: {
  item: CosmeticShopItem;
  tier: ShopView;
}) {
  const reflection = CARD_COSMETIC_DISPLAY[item.id]?.reflectionColor;
  return (
    <div className="yk-cosmetic-preview-card" aria-hidden="true">
      {item.kind === "back" ? (
        <CardBack cosmetic={item.id} />
      ) : reflection ? (
        <YokaiCard
          {...AUTH_EVOLUTION_CARDS[tier === "lr" ? 0 : 1]}
          isEvolved={tier === "special"}
          animated={false}
          cosmetics={{ animation: item.id }}
        />
      ) : (
        <YokaiCard
          name="Satoru Gojo"
          category="ANIME/MANGA"
          anime="Jujutsu Kaisen"
          rarity={tier === "ssr" ? "SSR" : "LR"}
          isEvolved={tier === "special"}
          image="/assets/premium-examples/gojo-original.png"
          animated={false}
          cosmetics={{ animation: item.id }}
        />
      )}
    </div>
  );
}
type Notice = "insufficient" | "priceChanged" | "purchaseFailed";

export function CosmeticShop({
  account,
  name,
  initial,
  offerId
}: {
  account: ReactNode;
  name?: string;
  initial: CosmeticShopState | null;
  offerId?: string;
}) {
  const t = useTranslations("cosmeticShop");
  const offer = initial?.items.find(item => item.id === offerId);
  const [view, setView] = useState<ShopView>(
    offer?.kind === "back"
      ? "backs"
      : offer
        ? (CARD_COSMETIC_DISPLAY[offer.id]?.tier ?? "ssr")
        : "ssr"
  );
  const [finishes, setFinishes] = useState(() => {
    if (!offer) return defaultFinish;
    const family = offerFamily(offer.id);
    return family ? { ...defaultFinish, [family]: offer.id } : defaultFinish;
  });
  const format = useFormatter();
  const [shop, setShop] = useState(initial);
  const [selected, setSelected] = useState<CosmeticShopItem | null>(null);
  const selectedEligibility = selected ? offerEligibility(selected) : undefined;
  const [quantity, setQuantity] = useState("1");
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<Notice>();
  const [backFeedback, setBackFeedback] = useState<"saved" | "failed">();
  const [purchaseResult, setPurchaseResult] = useState<{
    id: string;
    quantity: number;
  }>();
  const purchasing = useRef(false);
  const requestId = useRef<string>(null);
  const units = Number(quantity);
  const maxQuantity =
    selected && shop
      ? selected.kind === "back"
        ? Number(shop.balance >= selected.price && selected.quantity === 0)
        : Math.floor(shop.balance / selected.price)
      : 0;
  const canPurchase =
    Number.isInteger(units) && units > 0 && units <= maxQuantity;
  const visibleItems =
    shop?.items.filter(item => {
      const display = CARD_COSMETIC_DISPLAY[item.id];
      return (
        t.has(`items.${item.id}`) &&
        (view === "backs"
          ? item.kind === "back"
          : item.kind === "animation" &&
            (display?.tier === view || Boolean(display?.showcaseScene)))
      );
    }) ?? [];
  const products = new Map<
    string,
    { family?: CardCosmeticColorFamily; variants: CosmeticShopItem[] }
  >();
  for (const item of visibleItems) {
    const family = offerFamily(item.id);
    const key = family ?? item.id;
    const group = products.get(key);
    if (group) group.variants.push(item);
    else products.set(key, { family, variants: [item] });
  }

  async function purchase() {
    if (!selected || !canPurchase || purchasing.current) return;
    purchasing.current = true;
    setPending(true);
    setFailure(undefined);
    try {
      const db = createClient();
      requestId.current ??= crypto.randomUUID();
      const { data, error } = await db.rpc("buy_card_cosmetic", {
        p_cosmetic_id: selected.id,
        p_expected_price: selected.price,
        p_quantity: units,
        p_request: requestId.current
      });
      if (error) {
        const message = error.message;
        if (
          message === "INSUFFICIENT_KARAS" ||
          message === "TRADE_INSUFFICIENT_KARAS"
        ) {
          setFailure("insufficient");
        } else if (message === "COSMETIC_PRICE_CHANGED") {
          const fresh = await db.rpc("get_card_cosmetic_shop");
          if (fresh.data) {
            const next = fresh.data as CosmeticShopState;
            setShop(next);
            setSelected(
              next.items.find(item => item.id === selected.id) ?? null
            );
            requestId.current = null;
          }
          setFailure("priceChanged");
        } else {
          setFailure("purchaseFailed");
        }
        return;
      }
      setShop(data as CosmeticShopState);
      setPurchaseResult({ id: selected.id, quantity: units });
      setSelected(null);
      invalidatePlayerSnapshots(["balance", "profile"]);
    } catch {
      setFailure("purchaseFailed");
    } finally {
      purchasing.current = false;
      setPending(false);
    }
  }

  async function chooseInvocationBack(id: string | null) {
    if (purchasing.current) return;
    purchasing.current = true;
    setPending(true);
    setBackFeedback(undefined);
    try {
      const data = await setInvocationCardBack(id);
      if (!data) {
        setBackFeedback("failed");
      } else {
        setShop(data);
        setBackFeedback("saved");
      }
    } catch {
      setBackFeedback("failed");
    } finally {
      purchasing.current = false;
      setPending(false);
    }
  }

  function changeQuantity(value: string) {
    if (!/^\d{0,10}$/.test(value)) return;
    setQuantity(value);
    setFailure(undefined);
    requestId.current = null;
  }

  return (
    <>
      <Topbar view="shop" account={account} name={name} karas={shop?.balance} />
      <main id="main-content" className="yk-cosmetic-shop">
        <header className="yk-cosmetic-shop-hero">
          <div className="yk-cosmetic-shop-intro">
            <h1 className="yk-title">{t("title")}</h1>
            <p>{t("description")}</p>
            <Link
              href="/collection"
              className="yk-button yk-button-secondary yk-cosmetic-collection-link"
            >
              {t("myCollection")}
              <span aria-hidden="true">↗</span>
            </Link>
          </div>
          <div className="yk-cosmetic-shop-hero-art" aria-hidden="true">
            <CardBack cosmetic="violet_mist" />
            <CardBack cosmetic="midnight_sakura" />
          </div>
        </header>

        <section aria-labelledby="shop-card-cosmetics">
          <div
            className="yk-cosmetic-shop-tiers"
            role="group"
            aria-label={t("tiersLabel")}
          >
            {CARD_COSMETIC_TIERS.map(option => (
              <button
                key={option}
                type="button"
                data-tier={option}
                aria-pressed={view === option}
                aria-label={t(`tiers.${option}`)}
                aria-describedby={`shop-${option}-tier-detail`}
                aria-controls="shop-section-results"
                onClick={() => setView(option)}
              >
                <span className="yk-cosmetic-tier-icon" aria-hidden="true" />
                <span className="yk-cosmetic-tier-name">
                  <strong>{t(`tiers.${option}`)}</strong>
                  <small id={`shop-${option}-tier-detail`}>
                    {t(
                      option === "special"
                        ? "specialTierDetail"
                        : "standardTierDetail"
                    )}
                  </small>
                </span>
              </button>
            ))}
            <button
              type="button"
              data-tier="backs"
              aria-pressed={view === "backs"}
              aria-label={t("kinds.back")}
              aria-describedby="shop-backs-tier-detail"
              aria-controls="shop-section-results"
              onClick={() => setView("backs")}
            >
              <span className="yk-cosmetic-tier-icon" aria-hidden="true" />
              <span className="yk-cosmetic-tier-name">
                <strong>{t("kinds.back")}</strong>
                <small id="shop-backs-tier-detail">
                  {t("backsTierDetail")}
                </small>
              </span>
            </button>
          </div>
          <div
            id="shop-section-results"
            className="yk-cosmetic-shop-results"
            data-view={view}
          >
            <div className="yk-cosmetic-shop-heading">
              <h2 id="shop-card-cosmetics">
                {view === "backs" ? t("kinds.back") : t(`tierHeadings.${view}`)}
              </h2>
            </div>
            {purchaseResult && (
              <p className="yk-cosmetic-shop-success" role="status">
                {CARD_COSMETIC_DISPLAY[purchaseResult.id]?.kind === "back"
                  ? t("backPurchaseSuccess", {
                      name: t(`items.${purchaseResult.id}`)
                    })
                  : t("purchaseSuccess", {
                      name: t(`items.${purchaseResult.id}`),
                      quantity: purchaseResult.quantity
                    })}
              </p>
            )}
            {view === "backs" && backFeedback && (
              <p className="yk-cosmetic-shop-success" role="status">
                {t(
                  backFeedback === "saved"
                    ? "invocationBackSaved"
                    : "invocationBackFailed"
                )}
              </p>
            )}
            {!selected && failure && <p role="alert">{t(failure)}</p>}
            {shop && (products.size > 0 || view === "backs") ? (
              <ul className="yk-cosmetic-shop-grid">
                {view === "backs" && (
                  <li className="yk-cosmetic-offer" data-kind="back">
                    <div className="yk-cosmetic-offer-art">
                      <div
                        className="yk-cosmetic-preview-card"
                        aria-hidden="true"
                      >
                        <CardBack />
                      </div>
                    </div>
                    <div className="yk-cosmetic-offer-body">
                      <h3>{t("defaultInvocationBack")}</h3>
                      <div className="yk-cosmetic-offer-actions">
                        <Button
                          disabled={pending || !shop.invocationBack}
                          onClick={() => void chooseInvocationBack(null)}
                        >
                          {t(
                            shop.invocationBack
                              ? "useInvocationBack"
                              : "activeInvocationBack"
                          )}
                        </Button>
                      </div>
                    </div>
                  </li>
                )}
                {Array.from(products, ([key, { family, variants }]) => {
                  const item =
                    (family &&
                      variants.find(
                        variant => variant.id === finishes[family]
                      )) ||
                    variants[0];
                  const color = offerColor(item);
                  const title = family
                    ? t(`families.${family}`)
                    : t(`items.${item.id}`);
                  const canAfford = shop.balance >= item.price;
                  const ownedBack = item.kind === "back" && item.quantity > 0;
                  const activeBack = shop.invocationBack === item.id;
                  const eligibility = offerEligibility(item);
                  const eligibilityId = eligibility
                    ? `shop-${key}-eligibility`
                    : undefined;
                  return (
                    <li
                      key={key}
                      id={cosmeticOfferAnchor(item.id)}
                      className="yk-cosmetic-offer"
                      data-kind={item.kind}
                    >
                      <div className="yk-cosmetic-offer-art">
                        <CosmeticCardPreview item={item} tier={view} />
                      </div>
                      <div className="yk-cosmetic-offer-body">
                        <h3>{title}</h3>
                        {eligibility && (
                          <p
                            className="yk-cosmetic-eligibility"
                            id={eligibilityId}
                          >
                            {t(eligibility)}
                          </p>
                        )}
                        {family && color && (
                          <div className="yk-cosmetic-options">
                            <div
                              className="yk-cosmetic-swatch-row"
                              role="group"
                              aria-label={t("chooseColor", { name: title })}
                            >
                              {[...variants]
                                .sort(
                                  (a, b) =>
                                    CARD_COSMETIC_COLOR_ORDER.indexOf(
                                      offerColor(a) ?? ""
                                    ) -
                                    CARD_COSMETIC_COLOR_ORDER.indexOf(
                                      offerColor(b) ?? ""
                                    )
                                )
                                .map(variant => {
                                  const variantColor = offerColor(variant);
                                  if (!variantColor) return null;
                                  const label = t(`colors.${variantColor}`);
                                  return (
                                    <Button
                                      key={variant.id}
                                      variant={
                                        item.id === variant.id
                                          ? "primary"
                                          : "secondary"
                                      }
                                      className="yk-cosmetic-swatch"
                                      data-color={variantColor}
                                      aria-label={label}
                                      title={label}
                                      aria-pressed={item.id === variant.id}
                                      onClick={event => {
                                        replayCardCosmeticColor(
                                          event.currentTarget
                                            .closest(".yk-cosmetic-offer")
                                            ?.querySelector(
                                              ".yk-cosmetic-offer-art"
                                            ),
                                          family
                                        );
                                        setFinishes(current => ({
                                          ...current,
                                          [family]: variant.id
                                        }));
                                      }}
                                    >
                                      <span aria-hidden="true" />
                                    </Button>
                                  );
                                })}
                            </div>
                            <p
                              className="yk-cosmetic-selected-color"
                              aria-live="polite"
                            >
                              {t(`colors.${color}`)}
                            </p>
                          </div>
                        )}
                        {item.kind !== "back" && item.quantity > 0 && (
                          <p className="yk-cosmetic-offer-owned">
                            {t("copiesOwned", {
                              quantity: item.quantity,
                              available: item.available
                            })}
                          </p>
                        )}
                        <div className="yk-cosmetic-offer-actions">
                          {ownedBack ? (
                            <Button
                              disabled={pending || activeBack}
                              onClick={() => void chooseInvocationBack(item.id)}
                            >
                              {t(
                                activeBack
                                  ? "activeInvocationBack"
                                  : "useInvocationBack"
                              )}
                            </Button>
                          ) : (
                            <>
                              <Karas amount={item.price} />
                              <Button
                                variant="primary"
                                disabled={pending || !canAfford}
                                aria-describedby={eligibilityId}
                                aria-label={
                                  !canAfford
                                    ? t("insufficient")
                                    : t("buyItem", {
                                        name: t(`items.${item.id}`)
                                      })
                                }
                                onClick={() => {
                                  setFailure(undefined);
                                  setPurchaseResult(undefined);
                                  setSelected(item);
                                  changeQuantity("1");
                                }}
                              >
                                {!canAfford ? t("insufficientShort") : t("buy")}
                              </Button>
                            </>
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : shop ? (
              <p className="yk-cosmetic-shop-empty" role="status">
                {t("emptyCategory")}
              </p>
            ) : (
              <p role="alert">{t("loadFailed")}</p>
            )}
          </div>
        </section>
        <Modal
          open={selected !== null}
          title={t("confirmTitle")}
          onClose={() => {
            if (!purchasing.current) {
              setSelected(null);
              setFailure(undefined);
            }
          }}
        >
          {selected && shop && (
            <div className="yk-cosmetic-checkout">
              <div className="yk-cosmetic-checkout-product">
                <CosmeticCardPreview item={selected} tier={view} />
                <div>
                  <h3>{t(`items.${selected.id}`)}</h3>
                  {selectedEligibility && (
                    <p
                      className="yk-cosmetic-eligibility"
                      id="shop-checkout-eligibility"
                    >
                      {t(selectedEligibility)}
                    </p>
                  )}
                </div>
              </div>
              {selected.kind !== "back" && (
                <div className="yk-cosmetic-quantity">
                  <div>
                    <label htmlFor="shop-cosmetic-quantity">
                      {t("quantity")}
                    </label>
                    <p>{t("copiesPerCard")}</p>
                  </div>
                  <div className="yk-cosmetic-quantity-controls">
                    <Button
                      variant="secondary"
                      aria-label={t("lessCopies")}
                      disabled={pending || units <= 1}
                      onClick={() => changeQuantity(String(units - 1))}
                    >
                      −
                    </Button>
                    <input
                      id="shop-cosmetic-quantity"
                      type="text"
                      inputMode="numeric"
                      value={quantity}
                      disabled={pending}
                      onChange={event => changeQuantity(event.target.value)}
                    />
                    <Button
                      variant="secondary"
                      aria-label={t("moreCopies")}
                      disabled={pending || units >= maxQuantity}
                      onClick={() => changeQuantity(String(units + 1))}
                    >
                      +
                    </Button>
                  </div>
                </div>
              )}
              <dl>
                <div>
                  <dt>{t("unitPrice")}</dt>
                  <dd>
                    <Karas amount={selected.price} />
                  </dd>
                </div>
                {canPurchase && (
                  <>
                    <div>
                      <dt>{t("total")}</dt>
                      <dd aria-live="polite">
                        <Karas amount={selected.price * units} />
                      </dd>
                    </div>
                    <div>
                      <dt>{t("remaining")}</dt>
                      <dd>
                        {t("karasAmount", {
                          amount: format.number(
                            shop.balance - selected.price * units
                          )
                        })}
                      </dd>
                    </div>
                  </>
                )}
              </dl>
              {(failure || units > maxQuantity) && (
                <p className="text-danger" role="alert">
                  {t(failure ?? "insufficient")}
                </p>
              )}
              <Button
                variant="primary"
                disabled={pending || !canPurchase}
                aria-describedby={
                  selectedEligibility ? "shop-checkout-eligibility" : undefined
                }
                onClick={() => void purchase()}
              >
                {t(pending ? "purchasing" : "confirm")}
              </Button>
            </div>
          )}
        </Modal>
      </main>
    </>
  );
}
