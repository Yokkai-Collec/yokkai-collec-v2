"use client";

import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { useRef, useState, type CSSProperties } from "react";
import { Button } from "@/components/ui";
import { YokaiCard } from "@/components/yokai-card";
import { AUTH_EVOLUTION_CARDS } from "@/lib/auth/showcase-cards";
import {
  CARD_REFLECTION_COLORS,
  reflectionCosmeticId
} from "@/lib/ui/card-cosmetics";
import "@/styles/card-wave-preview.css";

const hawks = AUTH_EVOLUTION_CARDS[1];
const variants = ["original", ...CARD_REFLECTION_COLORS] as const;

export function CardWavePreview() {
  const t = useTranslations("cosmeticShop.wavePreview");
  const format = useFormatter();
  const [speed, setSpeed] = useState(1);
  const [intensity, setIntensity] = useState(85);
  const [enabled, setEnabled] = useState(true);
  const [variant, setVariant] = useState<(typeof variants)[number]>("original");
  const [isolated, setIsolated] = useState(false);
  const [manuallyStarted, setManuallyStarted] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  const tuning = {
    "--wave-duration": `${3.8 / speed}s`,
    "--reflection-intensity": intensity / 100
  } as CSSProperties;

  function replay() {
    setEnabled(true);
    setManuallyStarted(true);
    const scan = stage.current?.querySelector(".yk-evolved-scan");
    for (const animation of scan?.getAnimations() ?? [])
      animation.currentTime = 0;
  }

  return (
    <main className="yk-wave-preview">
      <Link href="/shop" className="yk-wave-preview-back">
        <span aria-hidden="true">←</span> {t("shop")}
      </Link>
      <div className="yk-wave-preview-layout">
        <div className="yk-wave-preview-controls">
          <h1>{t("title")}</h1>
          <p>{t("description")}</p>
          <div
            className="yk-wave-preview-variants"
            role="group"
            aria-label={t("finish")}
          >
            {variants.map(color => (
              <Button
                key={color}
                variant="secondary"
                aria-pressed={variant === color}
                onClick={() => setVariant(color)}
              >
                {t(color)}
              </Button>
            ))}
          </div>
          <div className="yk-wave-preview-setting">
            <label htmlFor="wave-speed">{t("speed")}</label>
            <output htmlFor="wave-speed">{format.number(speed)}×</output>
            <input
              id="wave-speed"
              type="range"
              min={0.5}
              max={2}
              step={0.1}
              value={speed}
              onChange={event => setSpeed(event.currentTarget.valueAsNumber)}
            />
          </div>
          {variant !== "original" && (
            <div className="yk-wave-preview-setting">
              <label htmlFor="wave-intensity">{t("intensity")}</label>
              <output htmlFor="wave-intensity">
                {format.number(intensity / 100, { style: "percent" })}
              </output>
              <input
                id="wave-intensity"
                type="range"
                min={15}
                max={100}
                value={intensity}
                onChange={event =>
                  setIntensity(event.currentTarget.valueAsNumber)
                }
              />
            </div>
          )}
          <label className="yk-wave-preview-toggle">
            <input
              type="checkbox"
              checked={enabled}
              onChange={event => setEnabled(event.currentTarget.checked)}
            />
            {t("showEffect")}
          </label>
          <label className="yk-wave-preview-toggle">
            <input
              type="checkbox"
              checked={isolated}
              onChange={event => setIsolated(event.currentTarget.checked)}
            />
            {t("isolate")}
          </label>
          <Button onClick={replay}>{t("replay")}</Button>
        </div>
        <div
          className="yk-wave-preview-stage"
          ref={stage}
          data-wave-enabled={enabled}
          data-wave-manual={manuallyStarted}
          data-wave-isolated={isolated}
          style={tuning}
        >
          <div className="yk-wave-preview-card">
            <YokaiCard
              {...hawks}
              isEvolved
              imageLoading="eager"
              cosmetics={
                variant === "original"
                  ? undefined
                  : { animation: reflectionCosmeticId(variant) }
              }
            />
          </div>
        </div>
      </div>
    </main>
  );
}
