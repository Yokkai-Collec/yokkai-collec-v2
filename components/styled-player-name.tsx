import type { CSSProperties } from "react";
import {
  DEFAULT_PROFILE_STYLE,
  normalizeProfileStyle,
  nameStyleVariables,
  type ProfileStyle
} from "@/lib/ui/profile-style";
import { DecorativeBadge } from "@/components/decorative-badge";

export type PlayerCosmetics = {
  active: boolean;
  style: Partial<ProfileStyle>;
  titleId?: string;
};
export function ProBadge() {
  return (
    <span
      className="yk-profile-pro-badge"
      role="img"
      aria-label="Yokkai Pro"
      title="Yokkai Pro"
      data-pro-badge="true"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path
          className="yk-profile-pro-badge-seal"
          d="M12 1.5 14.3 3.4 17.3 2.9 18.4 5.7 21.1 7 20.5 10 22.5 12 20.5 14 21.1 17 18.4 18.3 17.3 21.1 14.3 20.6 12 22.5 9.7 20.6 6.7 21.1 5.6 18.3 2.9 17 3.5 14 1.5 12 3.5 10 2.9 7 5.6 5.7 6.7 2.9 9.7 3.4Z"
        />
        <path
          className="yk-profile-pro-badge-star"
          d="m12 5.8 1.92 3.89 4.29.62-3.1 3.03.73 4.27L12 15.59l-3.84 2.02.73-4.27-3.1-3.03 4.29-.62Z"
        />
      </svg>
    </span>
  );
}
export function StyledPlayerName({
  name,
  cosmetics,
  fallbackLabel
}: {
  name: string;
  cosmetics?: PlayerCosmetics;
  fallbackLabel?: string;
}) {
  if (!cosmetics?.active) return <>{fallbackLabel ?? name}</>;
  const style = normalizeProfileStyle({
    ...DEFAULT_PROFILE_STYLE,
    ...cosmetics.style
  });
  return (
    <span className="yk-styled-player-name">
      <span
        className="yk-style-name"
        data-name-effect={style.effect}
        style={nameStyleVariables(style) as CSSProperties}
      >
        {fallbackLabel ?? name}
      </span>
      <ProBadge />
      {style.badges.map(badge => (
        <DecorativeBadge key={badge} badge={badge} />
      ))}
    </span>
  );
}
