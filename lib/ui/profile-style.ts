import { readableNameColor } from "@/lib/ui/name-contrast";
import type { CSSProperties } from "react";

// Cosmetic presentation only; membership is always checked on the server.
export const NAME_FONTS = [
  {
    id: "modern",
    label: "Modern",
    family: "var(--font-sora), sans-serif",
    weight: 600
  },
  {
    id: "classic",
    label: "Classic",
    family: "var(--font-cinzel), Georgia, serif",
    weight: 600
  },
  {
    id: "mono",
    label: "Mono",
    family: 'Consolas, "Courier New", monospace',
    weight: 700
  },
  {
    id: "bold",
    label: "Bold",
    family: 'Impact, "Arial Black", sans-serif',
    weight: 400
  },
  {
    id: "editorial",
    label: "Editorial",
    family: "Georgia, serif",
    weight: 700
  },
  {
    id: "script",
    label: "Script",
    family: '"Segoe Script", cursive',
    weight: 700
  },
  {
    id: "arcade",
    label: "Arcade",
    family: '"Press Start 2P", monospace',
    weight: 400
  },
  {
    id: "comic",
    label: "Manga",
    family: '"Bangers", Impact, sans-serif',
    weight: 400
  },
  {
    id: "gothic",
    label: "Gothic",
    family: '"UnifrakturCook", Georgia, serif',
    weight: 700
  },
  {
    id: "signature",
    label: "Signature",
    family: '"Great Vibes", cursive',
    weight: 400
  },
  {
    id: "retro",
    label: "Retro",
    family: '"Pacifico", cursive',
    weight: 400
  },
  {
    id: "tech",
    label: "Futuristic",
    family: '"Orbitron", sans-serif',
    weight: 700
  },
  {
    id: "condensed",
    label: "Esports",
    family: '"Rajdhani", sans-serif',
    weight: 600
  },
  {
    id: "stencil",
    label: "Stencil",
    family: '"Black Ops One", Impact, sans-serif',
    weight: 400
  }
] as const;
export const NAME_EFFECTS = [
  { id: "solid", label: "Solid" },
  { id: "gradient", label: "Gradient" },
  { id: "neon", label: "Neon" },
  { id: "outline", label: "Outline" },
  { id: "pop", label: "Pop" },
  { id: "shimmer", label: "Shimmer" },
  { id: "prism", label: "Prism" },
  { id: "aurora", label: "Aurora" },
  { id: "chrome", label: "Chrome" },
  { id: "fire", label: "Fire" },
  { id: "frost", label: "Frost" },
  { id: "hologram", label: "Hologram" },
  { id: "glitch", label: "Glitch" },
  { id: "pulse", label: "Pulse" }
] as const;
export const NAME_COLORS = [
  { label: "Lavender", value: "#b69aff" },
  { label: "Rose", value: "#ff83bc" },
  { label: "Mint", value: "#75e5bd" },
  { label: "Sky", value: "#7ac9ff" },
  { label: "Gold", value: "#f3cb78" },
  { label: "Peach", value: "#ffb08d" },
  { label: "Pearl", value: "#eeebff" }
] as const;
export const STYLE_BADGES = [
  { id: "comet", label: "Comet", color: "#f3cb78" },
  { id: "bloom", label: "Bloom", color: "#ff83bc" },
  { id: "crystal", label: "Crystal", color: "#9ccaff" },
  { id: "orbit", label: "Orbit", color: "#b69aff" },
  { id: "flame", label: "Flame", color: "#ffb08d" },
  { id: "moon", label: "Moon", color: "#75e5bd" },
  { id: "crown", label: "Crown", color: "#f6ce72" },
  { id: "bolt", label: "Lightning", color: "#bca5ff" },
  { id: "heart", label: "Heart", color: "#ff7fa7" },
  { id: "swords", label: "Swords", color: "#b8d6ef" },
  { id: "gamepad", label: "Gamepad", color: "#91d8c4" },
  { id: "cat", label: "Cat", color: "#ffc496" },
  { id: "ghost", label: "Ghost", color: "#c6baff" },
  { id: "butterfly", label: "Butterfly", color: "#e9a6ef" }
] as const;
export type StyleBadge = (typeof STYLE_BADGES)[number]["id"];
export const AVATAR_FRAMES = [
  { id: "none", label: "No avatar frame" },
  { id: "orbit", label: "Orbit avatar frame" },
  { id: "crystal", label: "Crystal avatar frame" },
  { id: "bloom", label: "Bloom avatar frame" },
  { id: "flame", label: "Flame avatar frame" },
  { id: "cat", label: "Cat ears avatar frame" },
  { id: "royal", label: "Royal crown avatar frame" },
  { id: "sakura", label: "Sakura avatar frame" },
  { id: "wings", label: "Celestial wings avatar frame" },
  { id: "electric", label: "Electric avatar frame" },
  { id: "fox", label: "Fox spirit avatar frame" },
  { id: "roses", label: "Rose garden avatar frame" },
  { id: "lunar", label: "Starry moon avatar frame" },
  { id: "dragon", label: "Dragon avatar frame" },
  { id: "ocean", label: "Ocean waves avatar frame" },
  { id: "pixel", label: "Pixel arcade avatar frame" },
  { id: "bloodmoon", label: "Blood moon avatar frame" },
  { id: "shadow", label: "Shadow tendrils avatar frame" },
  { id: "rage", label: "Manga rage avatar frame" }
] as const;
export type AvatarFrame = (typeof AVATAR_FRAMES)[number]["id"];
export type ProfileStyle = {
  font: (typeof NAME_FONTS)[number]["id"];
  effect: (typeof NAME_EFFECTS)[number]["id"];
  color: string;
  secondary: string;
  badges: StyleBadge[];
  theme?: "default" | "amethyst" | "midnight" | "rose" | "ocean";
  avatarFrame?: AvatarFrame;
  showcaseEffect?: "none" | "glow" | "sparkle" | "prism";
  showcaseColor?: string;
  showcaseScene?:
    | "velvet"
    | "stars"
    | "marble"
    | "lightning"
    | "flames"
    | "mist"
    | "aurora"
    | "embers";
  showcaseLayout?: "row" | "fan" | "spotlight";
  showcaseIntensity?: number;
  showcaseTitle?: string;
  showcaseDescription?: string;
  backgroundUrl?: string;
  cardBackUrl?: string;
};
export const DEFAULT_PROFILE_STYLE: ProfileStyle = {
  font: "classic",
  effect: "solid",
  color: "#eeebff",
  secondary: "#b69aff",
  badges: []
};
export function normalizeProfileStyle(input: ProfileStyle): ProfileStyle {
  const hex = (value: string, fallback: string) =>
    /^#[a-f\d]{6}$/i.test(value) ? value : fallback;
  // Retired lookalikes keep a similar appearance without remaining selectable.
  const fontId = ["rounded", "display"].includes(input.font)
    ? "modern"
    : input.font;
  return {
    theme: ["default", "amethyst", "midnight", "rose", "ocean"].includes(
      input.theme ?? ""
    )
      ? input.theme
      : "default",
    avatarFrame: AVATAR_FRAMES.some(frame => frame.id === input.avatarFrame)
      ? input.avatarFrame
      : "none",
    showcaseEffect: ["none", "glow", "sparkle", "prism"].includes(
      input.showcaseEffect ?? ""
    )
      ? input.showcaseEffect
      : "none",
    ...(typeof input.showcaseColor === "string" &&
    /^#[a-f\d]{6}$/i.test(input.showcaseColor)
      ? { showcaseColor: input.showcaseColor }
      : {}),
    ...([
      "velvet",
      "stars",
      "marble",
      "lightning",
      "flames",
      "mist",
      "aurora",
      "embers"
    ].includes(input.showcaseScene ?? "")
      ? { showcaseScene: input.showcaseScene }
      : {}),
    ...(["row", "fan", "spotlight"].includes(input.showcaseLayout ?? "")
      ? { showcaseLayout: input.showcaseLayout }
      : {}),
    ...(Number.isInteger(input.showcaseIntensity) &&
    input.showcaseIntensity! >= 0 &&
    input.showcaseIntensity! <= 100
      ? { showcaseIntensity: input.showcaseIntensity }
      : {}),
    ...(typeof input.showcaseTitle === "string"
      ? {
          showcaseTitle: input.showcaseTitle
            .replace(/[\u0000-\u001f\u007f]/g, "")
            .trim()
            .slice(0, 60)
        }
      : {}),
    ...(typeof input.showcaseDescription === "string"
      ? {
          showcaseDescription: input.showcaseDescription
            .replace(/[\u0000-\u001f\u007f]/g, "")
            .trim()
            .slice(0, 160)
        }
      : {}),
    ...(safeStyleMedia(input.backgroundUrl)
      ? { backgroundUrl: input.backgroundUrl }
      : {}),
    ...(safeStyleMedia(input.cardBackUrl)
      ? { cardBackUrl: input.cardBackUrl }
      : {}),
    font: NAME_FONTS.some(font => font.id === fontId) ? fontId : "classic",
    effect: NAME_EFFECTS.some(effect => effect.id === input.effect)
      ? input.effect
      : "solid",
    color: hex(input.color, "#eeebff"),
    secondary: hex(input.secondary, "#b69aff"),
    badges: [...new Set(Array.isArray(input.badges) ? input.badges : [])]
      .filter(id => STYLE_BADGES.some(badge => badge.id === id))
      .slice(0, 3)
  };
}
export function nameStyleVariables(style: ProfileStyle) {
  const safe = normalizeProfileStyle(style);
  const font = NAME_FONTS.find(font => font.id === safe.font)!;
  return {
    "--name-font": font.family,
    "--name-weight": font.weight,
    "--name-readable-color": readableNameColor(safe.color),
    "--name-readable-secondary": readableNameColor(safe.secondary),
    "--name-color": safe.color,
    "--name-secondary": safe.secondary
  };
}
export function profileThemeVariables(style: ProfileStyle) {
  const safe = normalizeProfileStyle(style);
  return {
    "--profile-theme-primary": safe.color,
    "--profile-theme-accent": safe.secondary
  };
}
export function showcaseColorVariables(
  style?: Pick<ProfileStyle, "showcaseColor">
) {
  const color = style?.showcaseColor;
  return typeof color === "string" && /^#[a-f\d]{6}$/i.test(color)
    ? { "--showcase-color": color }
    : {};
}
export function safeStyleMedia(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2048) return false;
  try {
    const url = new URL(value);
    return (
      !url.username &&
      !url.password &&
      (url.protocol === "https:" ||
        (url.protocol === "http:" &&
          ["127.0.0.1", "localhost"].includes(url.hostname))) &&
      url.pathname.startsWith("/storage/v1/object/public/avatars/")
    );
  } catch {
    return false;
  }
}
export function randomProfileStyle(random = Math.random): ProfileStyle {
  const pick = <T>(values: readonly T[]) =>
    values[
      Math.min(
        values.length - 1,
        Math.max(0, Math.floor(random() * values.length))
      )
    ];
  return {
    font: pick(NAME_FONTS).id,
    effect: pick(NAME_EFFECTS).id,
    color: pick(NAME_COLORS).value,
    secondary: pick(NAME_COLORS).value,
    badges: [pick(STYLE_BADGES).id]
  };
}

export const PROFILE_WIDGET_LABELS: Record<string, string> = {
  "ANIME/MANGA": "favoriteanimemanga",
  "VIDEO GAMES": "favoritegames",
  KPOP: "kpopgroups",
  FILM: "favoritemovies",
  SERIE: "favoriteseries",
  KDRAMA: "favoriteKdramas",
  COMICS: "favoritecomics",
  ARTIST: "favoriteartists",
  VOCALOID: "favoriteVocaloids",
  MANWHA: "favoritemanhwa",
  SPORT: "favoritesports",
  "DISNEY CHANNEL": "disneyChannel",
  MEME: "favoritememes",
  BRAINROT: "favoritebrainrot"
};

export function tiltShowcaseCard(event: {
  currentTarget: HTMLElement;
  clientX: number;
  clientY: number;
  pointerType: string;
}) {
  if (
    event.pointerType !== "mouse" ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  )
    return;
  const card = event.currentTarget,
    box = card.getBoundingClientRect();
  card.style.setProperty(
    "--showcase-tilt-x",
    `${((event.clientX - box.left) / box.width - 0.5) * 8}deg`
  );
  card.style.setProperty(
    "--showcase-tilt-y",
    `${(0.5 - (event.clientY - box.top) / box.height) * 8}deg`
  );
}
export function resetShowcaseCard(event: { currentTarget: HTMLElement }) {
  event.currentTarget.style.removeProperty("--showcase-tilt-x");
  event.currentTarget.style.removeProperty("--showcase-tilt-y");
}

export function showcaseCardPosition(index: number, count: number) {
  return {
    "--showcase-fan-angle": `${(index - (count - 1) / 2) * Math.min(4, 20 / Math.max(1, count))}deg`
  };
}

export function showcaseDesignAttributes(style?: Partial<ProfileStyle>) {
  return {
    "data-showcase-scene": style?.showcaseScene,
    "data-showcase-layout": style?.showcaseLayout,
    style: {
      "--showcase-intensity": (style?.showcaseIntensity ?? 60) / 100
    } as CSSProperties
  };
}

export function showcaseSelection<T extends { instanceId: string }>(
  cards: T[],
  ids: Iterable<string>
) {
  const copies = new Map(cards.map(card => [card.instanceId, card]));
  return Array.from(ids).flatMap(id =>
    copies.has(id) ? [copies.get(id)!] : []
  );
}

export function resetProfileAppearance(style: ProfileStyle): ProfileStyle {
  return {
    ...DEFAULT_PROFILE_STYLE,
    badges: [],
    ...Object.fromEntries(
      Object.entries(style).filter(([key]) => key.startsWith("showcase"))
    )
  };
}
