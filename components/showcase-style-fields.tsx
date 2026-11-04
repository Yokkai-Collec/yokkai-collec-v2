"use client";
import { useTranslations } from "next-intl";
import type { CSSProperties } from "react";
import {
  showcaseColorVariables,
  type ProfileStyle
} from "@/lib/ui/profile-style";
import { ShowcaseColorPicker } from "@/components/showcase-color-picker";
import {
  ProfileShowcaseSample,
  ProfileStyleSelectionCheck
} from "@/components/profile-style-samples";
const showcaseEffects = [
  { id: "none", label: "No showcase effect" },
  { id: "glow", label: "Glow showcase effect" },
  { id: "sparkle", label: "Sparkle showcase effect" },
  { id: "prism", label: "Prism showcase effect" }
] as const;

export function ShowcaseStyleFields({
  value,
  onChange,
  busy
}: {
  value: ProfileStyle;
  onChange: (value: ProfileStyle) => void;
  busy: boolean;
}) {
  const t = useTranslations();
  return (
    <div
      className="yk-showcase-editor-effects"
      style={showcaseColorVariables(value) as CSSProperties}
    >
      <fieldset disabled={busy}>
        <legend>{t("profileUi.showcaseEffect")}</legend>
        <div className="yk-style-showcase-grid">
          {showcaseEffects.map(effect => (
            <button
              type="button"
              key={effect.id}
              className="yk-style-option yk-style-visual-option yk-style-showcase-option"
              aria-label={t(
                `profileUi.showcase${effect.id[0].toUpperCase()}${effect.id.slice(1)}`
              )}
              title={t(
                `profileUi.showcase${effect.id[0].toUpperCase()}${effect.id.slice(1)}`
              )}
              aria-pressed={(value.showcaseEffect ?? "none") === effect.id}
              onClick={() => onChange({ ...value, showcaseEffect: effect.id })}
            >
              <span
                className="yk-style-showcase-sample"
                data-showcase-effect={effect.id}
                aria-hidden="true"
              >
                <ProfileShowcaseSample />
              </span>
              {(value.showcaseEffect ?? "none") === effect.id && (
                <ProfileStyleSelectionCheck />
              )}
            </button>
          ))}
        </div>
        <ShowcaseColorPicker
          value={
            value.showcaseColor ??
            (value.showcaseEffect === "sparkle" ? "#f3cb78" : "#9abcff")
          }
          onChange={showcaseColor =>
            onChange({
              ...value,
              showcaseColor,
              showcaseEffect:
                !value.showcaseEffect || value.showcaseEffect === "none"
                  ? "glow"
                  : value.showcaseEffect
            })
          }
          onReset={() => onChange({ ...value, showcaseColor: undefined })}
        />
      </fieldset>
    </div>
  );
}
