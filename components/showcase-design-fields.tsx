"use client";
import { useTranslations } from "next-intl";
import type { CollectedCard } from "@/lib/data/cards";
import type { ProfileStyle } from "@/lib/ui/profile-style";
import { ShowcaseColorPicker } from "@/components/showcase-color-picker";
import { ShowcasePreview } from "@/components/showcase-preview";

export function ShowcaseDesignFields({
  value,
  onChange,
  busy,
  cards
}: {
  value: ProfileStyle;
  onChange: (value: ProfileStyle) => void;
  busy: boolean;
  cards: CollectedCard[];
}) {
  const t = useTranslations("profileUi");
  return (
    <div className="yk-showcase-customizer">
      <fieldset disabled={busy} className="yk-showcase-design-controls">
        <label>
          {t("showcaseTitle")}
          <input
            className="auth-input"
            maxLength={60}
            value={value.showcaseTitle ?? ""}
            onChange={e =>
              onChange({ ...value, showcaseTitle: e.target.value })
            }
          />
        </label>
        <label>
          {t("showcaseDescription")}
          <input
            className="auth-input"
            maxLength={160}
            value={value.showcaseDescription ?? ""}
            onChange={e =>
              onChange({ ...value, showcaseDescription: e.target.value })
            }
          />
        </label>
        <fieldset>
          <legend>{t("showcaseScene")}</legend>
          <div className="yk-showcase-choices">
            {(["velvet", "stars", "marble"] as const).map(scene => (
              <button
                type="button"
                key={scene}
                className="yk-showcase-scene-choice"
                data-scene={scene}
                aria-pressed={(value.showcaseScene ?? "velvet") === scene}
                onClick={() =>
                  onChange({
                    ...value,
                    showcaseScene: scene,
                    showcaseEffect: "none"
                  })
                }
              >
                <span aria-hidden="true" />
                {t(`showcaseScene${scene[0].toUpperCase()}${scene.slice(1)}`)}
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend>{t("showcaseLayout")}</legend>
          <div className="yk-showcase-choices">
            {(["row", "fan", "spotlight"] as const).map(layout => (
              <button
                type="button"
                key={layout}
                className="yk-showcase-layout-choice"
                data-layout={layout}
                aria-pressed={(value.showcaseLayout ?? "row") === layout}
                onClick={() =>
                  onChange({
                    ...value,
                    showcaseLayout: layout,
                    showcaseScene: value.showcaseScene ?? "velvet",
                    showcaseEffect: "none"
                  })
                }
              >
                <span aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
                {t(
                  `showcaseLayout${layout[0].toUpperCase()}${layout.slice(1)}`
                )}
              </button>
            ))}
          </div>
        </fieldset>
        <label className="yk-showcase-intensity">
          <span>
            {t("showcaseIntensity")}
            <output>{value.showcaseIntensity ?? 60}%</output>
          </span>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={value.showcaseIntensity ?? 60}
            onChange={e =>
              onChange({
                ...value,
                showcaseIntensity: Number(e.target.value),
                showcaseScene: value.showcaseScene ?? "velvet",
                showcaseEffect: "none"
              })
            }
          />
        </label>
        <ShowcaseColorPicker
          value={value.showcaseColor ?? "#9abcff"}
          onChange={showcaseColor =>
            onChange({
              ...value,
              showcaseColor,
              showcaseScene: value.showcaseScene ?? "velvet",
              showcaseEffect: "none"
            })
          }
          onReset={() => onChange({ ...value, showcaseColor: undefined })}
        />
      </fieldset>
      <ShowcasePreview cards={cards} value={value} />
    </div>
  );
}
