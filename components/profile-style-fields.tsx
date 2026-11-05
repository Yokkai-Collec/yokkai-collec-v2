"use client";
import { useTranslations } from "next-intl";

import Link from "next/link";
import type { CSSProperties } from "react";
import type { ProfileStyle } from "@/lib/ui/profile-style";
import {
  NAME_FONTS,
  NAME_EFFECTS,
  STYLE_BADGES,
  resetProfileAppearance,
  nameStyleVariables,
  showcaseColorVariables
} from "@/lib/ui/profile-style";
import { AVATAR_FRAMES } from "@/lib/ui/profile-style";
import { AvatarDecoration } from "@/components/avatar-decoration";
import { useProAccess, useProMembershipStatus } from "@/components/pro-access";
import { StyledPlayerName } from "@/components/styled-player-name";
import { DecorativeBadge } from "@/components/decorative-badge";
import { ShowcaseStyleFields } from "@/components/showcase-style-fields";

import {
  ProfileAvatarSample,
  ProfileShowcaseSample,
  ProfileStyleSelectionCheck
} from "@/components/profile-style-samples";

function hexToRgb(hex: string) {
  const value = /^#[a-f\d]{6}$/i.test(hex) ? hex.slice(1) : "000000";
  return [0, 2, 4].map(offset =>
    Number.parseInt(value.slice(offset, offset + 2), 16)
  );
}

function rgbToHex(values: number[]) {
  return `#${values
    .map(value =>
      Math.min(255, Math.max(0, Math.round(value)))
        .toString(16)
        .padStart(2, "0")
    )
    .join("")}`;
}

function RgbColorControl({
  label,
  value,
  onChange
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const t = useTranslations();
  const rgb = hexToRgb(value);
  return (
    <div className="yk-style-rgb-control">
      <div className="yk-style-rgb-heading">
        <span>{label}</span>
        <input
          type="color"
          value={value}
          aria-label={t("profileUi.colorPicker", { label })}
          onChange={event => onChange(event.target.value)}
        />
      </div>
      <div className="yk-style-rgb-values">
        {(["R", "G", "B"] as const).map((channel, index) => (
          <label key={channel}>
            <input
              type="number"
              min="0"
              max="255"
              inputMode="numeric"
              aria-label={t("profileUi.colorChannel", { label, channel })}
              value={rgb[index]}
              onChange={event => {
                const next = [...rgb];
                next[index] = Number(event.target.value);
                onChange(rgbToHex(next));
              }}
            />
            <span>{channel}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

export function ProfileStyleFields({
  value,
  onChange,
  busy,
  name,
  avatarUrl,
  showShowcase = true
}: {
  value: ProfileStyle;
  onChange: (value: ProfileStyle) => void;
  busy: boolean;
  name: string;
  avatarUrl?: string | null;
  showShowcase?: boolean;
}) {
  const t = useTranslations();
  const pro = useProAccess();
  const membership = useProMembershipStatus();
  return (
    <section
      className="yk-style-embedded"
      aria-labelledby="profile-style-heading"
      style={showcaseColorVariables(value) as CSSProperties}
    >
      <div className="yk-style-embedded-heading">
        <h3 id="profile-style-heading">{t("profileUi.profileStyle")}</h3>
        <span>
          {membership === true
            ? t("profileUi.proactive")
            : membership === false
              ? t("profileUi.previewonly")
              : t("profileUi.statusunavailable")}
        </span>
      </div>
      {!pro && (
        <p className="yk-style-trial-note" role="status">
          {membership === true ? (
            <>{t("profileUi.proStyleUnavailable")} </>
          ) : membership === null ? (
            <>{t("profileUi.membershipUnavailable")}</>
          ) : (
            <>
              {t.rich("profileUi.styleTrial", {
                pro: chunks => <Link href="/premium">{chunks}</Link>
              })}
            </>
          )}
        </p>
      )}
      <div className="yk-style-workspace">
        <fieldset disabled={busy} className="yk-style-embedded-fields">
          <legend className="sr-only">
            {t("profileUi.profileStyleSettings")}
          </legend>
          <div className="yk-style-controls">
            <fieldset>
              <legend>{t("profileUi.chooseYourFont")}</legend>
              <div className="yk-style-font-grid">
                {NAME_FONTS.map(font => (
                  <button
                    type="button"
                    key={font.id}
                    className="yk-style-option yk-style-font-option"
                    aria-label={t("profileUi.profileFont", {
                      label: t(
                        `profileUi.fonts${font.id[0].toUpperCase()}${font.id.slice(1)}`
                      )
                    })}
                    aria-pressed={value.font === font.id}
                    style={{ fontFamily: font.family, fontWeight: font.weight }}
                    onClick={() => onChange({ ...value, font: font.id })}
                  >
                    <span aria-hidden="true">Abc</span>
                    <small>
                      {t(
                        `profileUi.fonts${font.id[0].toUpperCase()}${font.id.slice(1)}`
                      )}
                    </small>
                  </button>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend>{t("profileUi.chooseYourEffect")}</legend>
              <div className="yk-style-effect-grid">
                {NAME_EFFECTS.map(effect => (
                  <button
                    type="button"
                    key={effect.id}
                    className="yk-style-option"
                    aria-label={t("profileUi.nameEffect", {
                      label: t(
                        `profileUi.effects${effect.id[0].toUpperCase()}${effect.id.slice(1)}`
                      )
                    })}
                    aria-pressed={value.effect === effect.id}
                    onClick={() => onChange({ ...value, effect: effect.id })}
                  >
                    <span
                      className="yk-style-name"
                      data-name-effect={effect.id}
                      style={
                        nameStyleVariables({
                          ...value,
                          font: "modern",
                          effect: effect.id
                        }) as CSSProperties
                      }
                    >
                      {t(
                        `profileUi.effects${effect.id[0].toUpperCase()}${effect.id.slice(1)}`
                      )}
                    </span>
                  </button>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend>{t("profileUi.nameColors")}</legend>
              <p className="yk-style-help">{t("profileUi.nameColorHint")} </p>
              <div className="yk-style-custom-colors">
                <RgbColorControl
                  label={t("profileUi.primary")}
                  value={value.color}
                  onChange={color => onChange({ ...value, color })}
                />
                <RgbColorControl
                  label={t("profileUi.accent")}
                  value={value.secondary}
                  onChange={secondary => onChange({ ...value, secondary })}
                />
              </div>
            </fieldset>
            <fieldset>
              <legend>
                {t("profileUi.decorativeBadgeCount", {
                  count: value.badges.length
                })}
              </legend>
              <div className="yk-style-badge-grid">
                {STYLE_BADGES.map(badge => (
                  <button
                    type="button"
                    key={badge.id}
                    className="yk-style-option yk-style-badge-option"
                    aria-label={t("profileUi.decorativeBadge", {
                      label: t(
                        `profileUi.badges${badge.id[0].toUpperCase()}${badge.id.slice(1)}`
                      )
                    })}
                    title={t(
                      `profileUi.badges${badge.id[0].toUpperCase()}${badge.id.slice(1)}`
                    )}
                    aria-pressed={value.badges.includes(badge.id)}
                    disabled={
                      value.badges.length >= 3 &&
                      !value.badges.includes(badge.id)
                    }
                    onClick={() =>
                      onChange({
                        ...value,
                        badges: value.badges.includes(badge.id)
                          ? value.badges.filter(id => id !== badge.id)
                          : [...value.badges, badge.id]
                      })
                    }
                  >
                    <DecorativeBadge badge={badge.id} decorative />
                    {value.badges.includes(badge.id) && (
                      <ProfileStyleSelectionCheck />
                    )}
                  </button>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend>{t("profileUi.avatarFrame")}</legend>
              <div className="yk-style-frame-grid">
                {AVATAR_FRAMES.map(frame => (
                  <button
                    type="button"
                    key={frame.id}
                    className="yk-style-option yk-style-visual-option"
                    aria-label={t(
                      `profileUi.frames${frame.id[0].toUpperCase()}${frame.id.slice(1)}`
                    )}
                    title={t(
                      `profileUi.frames${frame.id[0].toUpperCase()}${frame.id.slice(1)}`
                    )}
                    aria-pressed={(value.avatarFrame ?? "none") === frame.id}
                    onClick={() =>
                      onChange({ ...value, avatarFrame: frame.id })
                    }
                  >
                    <span
                      className="yk-style-frame-sample"
                      data-avatar-frame={frame.id}
                      aria-hidden="true"
                    >
                      <span className="yk-style-profile-preview-avatar">
                        <ProfileAvatarSample name={name} image={avatarUrl} />
                        <AvatarDecoration frame={frame.id} />
                      </span>
                    </span>
                    {(value.avatarFrame ?? "none") === frame.id && (
                      <ProfileStyleSelectionCheck />
                    )}
                  </button>
                ))}
              </div>
            </fieldset>
            {showShowcase && (
              <ShowcaseStyleFields
                value={value}
                onChange={onChange}
                busy={busy}
              />
            )}
            <button
              type="button"
              className="yk-style-reset"
              onClick={() => onChange(resetProfileAppearance(value))}
            >
              {t("profileUi.resetStyle")}{" "}
            </button>
          </div>
        </fieldset>
        <aside className="yk-style-preview-column">
          <span className="yk-style-preview-eyebrow">
            {t("profileUi.livepreview")}
          </span>
          <div
            className="yk-style-profile-preview"
            aria-label={t("profileUi.profileStylePreview")}
            aria-live="polite"
            data-profile-theme="default"
            data-avatar-frame={value.avatarFrame ?? "none"}
            data-showcase-effect={value.showcaseEffect ?? "none"}
          >
            <div className="yk-style-profile-preview-banner" aria-hidden="true">
              <span>✦</span>
            </div>
            <div className="yk-style-profile-preview-body">
              <div
                className="yk-style-profile-preview-avatar"
                aria-hidden="true"
              >
                <ProfileAvatarSample name={name} image={avatarUrl} />
                <AvatarDecoration frame={value.avatarFrame} />
              </div>
              <StyledPlayerName
                name={name}
                cosmetics={{ active: true, style: value }}
              />
              <p>{t("profileUi.livePreviewHint")}</p>
              <ProfileShowcaseSample />
              <small>{t("profileUi.nameStyleSurfaces")} </small>
            </div>
          </div>
          <p className="yk-style-preview-note">
            {t("profileUi.previewSaveHint")}{" "}
          </p>
        </aside>
      </div>
    </section>
  );
}
