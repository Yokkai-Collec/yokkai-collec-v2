"use client";
import { formatLicenseName } from "@/lib/ui/license-name";
import Link from "next/link";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useFormatter, useTranslations } from "next-intl";
import {
  getPackBinderGains,
  type PackBinderGain
} from "@/lib/data/binder-discovery";
import type { Card } from "@/lib/data/cards";
import { binderHref } from "@/lib/ui/binder-discovery";
import { binderIdentity } from "@/lib/ui/binder-identity";
import { enableHorizontalWheel } from "@/lib/ui/horizontal-wheel";
import "@/styles/binder-discovery.css";
export function PackBinderProgress({
  cards,
  load = getPackBinderGains
}: {
  cards: Card[];
  load?: typeof getPackBinderGains;
}) {
  const t = useTranslations("binderDiscovery");
  const format = useFormatter();
  const strip = useRef<HTMLUListElement>(null);
  const [progress, setProgress] = useState<{
    key: string;
    gains: PackBinderGain[];
  } | null>(null);
  const key = cards
    .map(card => card.id)
    .sort()
    .join(",");
  useEffect(() => {
    let active = true;
    if (!key) return;
    void load(cards).then(
      gains => {
        if (active) setProgress({ key, gains });
      },
      () => {}
    );
    return () => {
      active = false;
    };
    // The card IDs define an opening, even if the reveal component re-renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, load]);
  const gains = progress?.key === key ? progress.gains : [];
  useEffect(() => {
    const element = strip.current;
    if (!element) return;
    return enableHorizontalWheel(element);
  }, [gains.length]);
  if (!gains.length) return null;
  return (
    <section
      className="yk-pack-binder-progress"
      aria-labelledby="pack-binders-title"
    >
      <h3 id="pack-binders-title">{t("packTitle")}</h3>
      <ul
        ref={strip}
        style={
          { "--binder-columns": Math.min(gains.length, 5) } as CSSProperties
        }
      >
        {gains.map(gain => (
          <li key={binderIdentity(gain)}>
            <Link href={binderHref(gain)}>
              <strong className="yk-pack-binder-name">
                {formatLicenseName(gain.license)}
              </strong>
              <span
                className="yk-pack-binder-gain"
                aria-label={t("newForBinder", { count: gain.added })}
              >
                {t("gainBadge", { count: gain.added })}
              </span>
              <span
                className="yk-pack-binder-count"
                aria-label={t("count", {
                  owned: gain.owned,
                  total: gain.total
                })}
              >
                <b>{format.number(gain.owned)}</b>
                <span>{t("countTotal", { total: gain.total })}</span>
              </span>
              <span className="yk-pack-binder-percent">
                {format.number(
                  Math.floor((gain.owned / Math.max(1, gain.total)) * 1000) /
                    1000,
                  { style: "percent", maximumFractionDigits: 1 }
                )}
              </span>
              <progress
                value={gain.owned}
                max={gain.total}
                aria-label={t("progressFor", {
                  name: formatLicenseName(gain.license)
                })}
              />
              <span className="sr-only">
                {cards
                  .filter(card => gain.cardIds.includes(card.id))
                  .map(card => card.name)
                  .join(" · ")}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
