"use client";

import Image from "next/image";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui";
import { CardBack, YokaiCard } from "@/components/yokai-card";
import { AUTH_EVOLUTION_CARDS } from "@/lib/auth/showcase-cards";

export function CardBackInvocationPreview({
  id,
  name
}: {
  id?: string;
  name: string;
}) {
  const t = useTranslations("cosmeticShop");
  const [run, setRun] = useState(0);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setRevealed(true), 1450);
    return () => window.clearTimeout(timer);
  }, [run]);

  return (
    <section className="yk-invocation-preview" aria-label={name}>
      <div
        key={run}
        className="yk-invocation-preview-stage"
        data-revealed={revealed}
        aria-hidden="true"
      >
        <Image
          className="yk-invocation-preview-pack"
          src="/assets/chrome-regular-booster-v1.png"
          alt=""
          width={192}
          height={269}
        />
        <div className="yk-invocation-preview-deck">
          <CardBack className="yk-invocation-preview-left" cosmetic={id} />
          <CardBack className="yk-invocation-preview-right" cosmetic={id} />
          <div className="yk-invocation-preview-turn">
            <CardBack className="yk-invocation-preview-back" cosmetic={id} />
            <div className="yk-invocation-preview-front">
              <YokaiCard {...AUTH_EVOLUTION_CARDS[0]} animated={false} />
            </div>
          </div>
        </div>
      </div>
      <p role="status">
        {t(
          revealed ? "invocationPreviewRevealed" : "invocationPreviewOpening",
          { name }
        )}
      </p>
      <Button
        variant="secondary"
        disabled={!revealed}
        onClick={() => {
          setRevealed(false);
          setRun(value => value + 1);
        }}
      >
        {t("replayInvocationPreview")}
      </Button>
    </section>
  );
}
