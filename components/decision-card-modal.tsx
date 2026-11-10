"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Button, Karas, Modal } from "@/components/ui";
import { YokaiCard } from "@/components/yokai-card";
import type { RevealCard } from "@/components/boosters";
import { getCardDiscovery, type CardDiscovery } from "@/lib/data/wishlist";

export function DecisionCardModal({
  card,
  ownedCopies,
  keepReward,
  disabled = false,
  onClose,
  onChoose
}: {
  card: RevealCard;
  ownedCopies?: number;
  keepReward?: number;
  disabled?: boolean;
  onClose: () => void;
  onChoose: () => void;
}) {
  const t = useTranslations("packs.decisionCard");
  const [result, setResult] = useState<{
    detail?: CardDiscovery;
    failed?: boolean;
  }>();
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    void getCardDiscovery(card.id, 0, 1, !!card.shiny).then(
      detail => {
        if (active) setResult({ detail });
      },
      () => {
        if (active) setResult({ failed: true });
      }
    );
    return () => {
      active = false;
    };
  }, [card.id, card.shiny, attempt]);
  const detail = result?.detail;
  const pending = !result;
  const unavailable = pending ? t("loading") : t("unavailable");

  return (
    <Modal
      open
      onClose={onClose}
      title={card.name}
      hideTitle
      className="yk-decision-card-modal"
    >
      <div className="yk-decision-layout">
        <div className="yk-decision-art">
          <YokaiCard {...card} />
        </div>
        <div className="yk-decision-info">
          <div className="yk-decision-intro">
            <p className="eyebrow">Decision Pack</p>
            <h3>{t("title")}</h3>
            {(detail?.wishlisted ?? card.wishlisted) && (
              <p className="text-karas">{t("wishlisted")}</p>
            )}
          </div>
          <dl className="yk-decision-stats" aria-busy={pending}>
            <div>
              <dt>{t("owned")}</dt>
              <dd>
                {ownedCopies === undefined
                  ? t("unavailable")
                  : t("copies", { count: ownedCopies })}
              </dd>
            </div>
            <div>
              <dt>{t("owners")}</dt>
              <dd>
                {detail
                  ? t("players", { count: detail.ownerCount })
                  : unavailable}
              </dd>
            </div>
            <div>
              <dt>{t("market")}</dt>
              <dd>
                {detail ? (
                  detail.marketValue === null ? (
                    t("noSales")
                  ) : (
                    <Karas amount={Math.round(detail.marketValue)} />
                  )
                ) : (
                  unavailable
                )}
              </dd>
            </div>
            <div>
              <dt>{t("sellValue")}</dt>
              <dd>
                {card.destructionValue != null ? (
                  <Karas amount={card.destructionValue} />
                ) : (
                  t("unavailable")
                )}
              </dd>
            </div>
          </dl>
          <details className="yk-decision-note">
            <summary>{t("aboutStats")}</summary>
            <p>{t("statsNote")}</p>
          </details>
          {pending && (
            <p role="status" className="text-sm text-ink-3">
              {t("loading")}
            </p>
          )}
          {result?.failed && (
            <div role="alert" className="yk-decision-error">
              <p>{t("error")}</p>
              <Button
                variant="secondary"
                onClick={() => {
                  setResult(undefined);
                  setAttempt(value => value + 1);
                }}
              >
                {t("retry")}
              </Button>
            </div>
          )}
          <div className="yk-decision-outcome">
            <p>{t("ifKept")}</p>
            {keepReward != null && (
              <p>
                {t.rich("keepReward", {
                  amount: () => <Karas amount={keepReward} />
                })}
              </p>
            )}
          </div>
          <div className="yk-decision-modal-actions">
            <Button variant="secondary" onClick={onClose}>
              {t("back")}
            </Button>
            <Button disabled={disabled} onClick={onChoose}>
              {t("choose")}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
