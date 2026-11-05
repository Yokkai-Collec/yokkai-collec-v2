"use client";
import { useTranslations } from "next-intl";
import { useShowcaseScroll } from "@/hooks/use-showcase-scroll";
import type { CSSProperties } from "react";
import { YokaiCard } from "@/components/yokai-card";
import { ShowcaseAtmosphere } from "@/components/showcase-atmosphere";
import {
  showcaseColorVariables,
  showcaseCardPosition,
  showcaseDesignAttributes,
  type ProfileStyle
} from "@/lib/ui/profile-style";
import type { CollectedCard } from "@/lib/data/cards";

export function ShowcasePreview({
  cards,
  value
}: {
  cards: CollectedCard[];
  value: ProfileStyle;
}) {
  const t = useTranslations("profileUi");
  const scrollRef = useShowcaseScroll(cards.length);
  return (
    <section className="yk-showcase-live-preview" aria-label={t("livepreview")}>
      <ShowcaseAtmosphere
        scene={value.showcaseScene}
        intensity={value.showcaseIntensity}
      />
      <header>
        <span>{t("livepreview")}</span>
        <h3>{value.showcaseTitle || t("featuredCards")}</h3>
        {value.showcaseDescription && <p>{value.showcaseDescription}</p>}
      </header>
      {cards.length ? (
        <div
          className="yk-profile-hub"
          data-showcase-effect={value.showcaseEffect ?? "none"}
          style={showcaseColorVariables(value) as CSSProperties}
        >
          <div
            className="yk-featured-stage yk-showcase-design"
            ref={scrollRef}
            {...showcaseDesignAttributes(value)}
          >
            {cards.map((card, index) => (
              <div
                key={card.instanceId}
                style={
                  showcaseCardPosition(index, cards.length) as CSSProperties
                }
              >
                <YokaiCard {...card} animated={false} />
              </div>
            ))}
          </div>
        </div>
      ) : (
        <p className="yk-showcase-preview-empty">{t("showcasePreviewEmpty")}</p>
      )}
    </section>
  );
}
