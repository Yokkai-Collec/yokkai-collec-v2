/* eslint-disable @next/next/no-img-element */
import { cardRarityLabel } from "@/lib/ui/card-rarity-label";
import { formatLicenseName } from "@/lib/ui/license-name";
import "server-only";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { isShareImageUrl } from "@/lib/server/card-sharing";
import type { Rarity } from "@/lib/data/cards";
import type { SharedCard } from "@/lib/server/card-sharing";

export type ShareImageFormat = "og" | "story" | "square";
const sizes = {
  og: { width: 1200, height: 630 },
  story: { width: 1080, height: 1920 },
  square: { width: 1080, height: 1080 }
};
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const IMAGE_TIMEOUT_MS = 2000;
const allowedTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif"
]);
export const font = readFile(join(process.cwd(), "public/fonts/Sora-Bold.ttf"));
export const nameFont = readFile(
  join(process.cwd(), "public/fonts/Cinzel-Bold.ttf")
);
export const logo = readFile(
  join(process.cwd(), "public/assets/brand-logo-ice-retro.png")
).then(bytes => `data:image/png;base64,${bytes.toString("base64")}`);
const tokensSource = readFile(
  join(process.cwd(), "styles/card-tokens.css"),
  "utf8"
);
export const ink = { 1: "#F1EEFF", 2: "#A8A3C7", 3: "#8580AB" };
// Mirrors .yk-evolved in styles/cards.css, whose values are not tokens.
const evolution = {
  SSR: {
    edge: "#ffd7eb",
    base: "#48152e",
    mid: "#180d17",
    glow: "rgba(255,42,147,.62)"
  },
  LR: {
    edge: "#fff0b8",
    base: "#44300c",
    mid: "#191307",
    glow: "rgba(238,185,49,.62)"
  }
};

export function siteHost() {
  try {
    return new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "").host;
  } catch {
    return "yokkai-collec.com";
  }
}

function variable(source: string, name: string) {
  const match = source.match(
    new RegExp(`${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*:\\s*([^;]+)`)
  );
  if (!match) throw new Error(`Missing card token ${name}`);
  return match[1].trim();
}

function resolved(source: string, value: string) {
  return value.replace(/var\((--[a-z0-9-]+)\)/gi, (_match, name: string) =>
    variable(source, name)
  );
}

function supportedGradient(value: string) {
  if (!value.startsWith("conic-gradient")) return value;
  const colors = value.match(/#[0-9a-f]{3,8}/gi);
  return colors?.length
    ? `linear-gradient(135deg,${colors.join(",")})`
    : "#E8C26A";
}

export async function rarityTokens(
  rarity: Rarity,
  shiny: boolean,
  isEvolved = false
) {
  const source = await tokensSource;
  const block = source.match(
    new RegExp(`\\.yk-rarity-${rarity}\\s*\\{([^}]+)\\}`)
  )?.[1];
  if (!block) throw new Error(`Missing rarity ${rarity}`);
  const token = (name: string) => resolved(source, variable(block, name));
  const evolved =
    (isEvolved || (shiny && rarity === "SSR")) &&
    (rarity === "SSR" || rarity === "LR")
      ? evolution[rarity]
      : null;
  const holo = !evolved && shiny && (rarity === "SSR" || rarity === "LR");
  const glow = token("--card-glow-color");
  const badgeBorder = token("--card-badge-border");
  return {
    frame: supportedGradient(
      resolved(
        source,
        evolved
          ? variable(
              source,
              rarity === "LR" ? "--lr-evolved-frame" : "--evolved-frame"
            )
          : holo
            ? variable(source, "--holo-frame")
            : variable(block, "--card-frame")
      )
    ),
    background: evolved
      ? `radial-gradient(110% 75% at 50% 32%, ${evolved.base}, ${evolved.mid} 64%, #08060b)`
      : token("--card-bg"),
    // CSS pixels at the 300px reference width of the in-game card.
    inset: evolved ? 5 : Number.parseFloat(token("--card-inset")),
    line: token("--card-line"),
    badge: token("--card-badge"),
    badgeInk: token("--card-badge-ink"),
    badgeBorder,
    special: evolved
      ? {
          kind: "evolved" as const,
          background: "linear-gradient(180deg,#293240,#111722 52%,#080c13)",
          color: evolved.edge
        }
      : holo
        ? {
            kind: "shiny" as const,
            background: supportedGradient(variable(source, "--holo-badge")),
            color: "#04000B"
          }
        : null,
    glow: evolved
      ? evolved.glow
      : holo
        ? variable(source, "--holo-glow")
        : glow === "transparent"
          ? null
          : glow,
    label: evolved ? evolved.edge : holo ? "#E8FBFF" : badgeBorder
  };
}
type CardColors = Awaited<ReturnType<typeof rarityTokens>>;

function validMagic(bytes: Uint8Array, type: string) {
  if (type === "image/png")
    return [137, 80, 78, 71, 13, 10, 26, 10].every(
      (value, index) => bytes[index] === value
    );
  if (type === "image/jpeg")
    return (
      bytes[0] === 255 &&
      bytes[1] === 216 &&
      bytes[bytes.length - 2] === 255 &&
      bytes[bytes.length - 1] === 217
    );
  if (type === "image/gif")
    return (
      new TextDecoder().decode(bytes.slice(0, 6)).match(/^GIF8[79]a$/) !== null
    );
  return (
    type === "image/webp" &&
    new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" &&
    new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP"
  );
}

export async function fetchCatalogueImage(
  url: string,
  fetchImage: typeof fetch = fetch
) {
  try {
    if (!isShareImageUrl(url)) return null;
    const response = await fetchImage(new URL(url), {
      redirect: "error",
      signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS),
      headers: { Accept: "image/png,image/jpeg,image/webp,image/gif" }
    });
    if (!response.ok) return null;
    const type =
      response.headers
        .get("content-type")
        ?.split(";")[0]
        .trim()
        .toLowerCase() ?? "";
    if (
      !allowedTypes.has(type) ||
      Number(response.headers.get("content-length")) > MAX_IMAGE_BYTES
    )
      return null;
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (
      !bytes.length ||
      bytes.byteLength > MAX_IMAGE_BYTES ||
      !validMagic(bytes, type)
    )
      return null;
    return `data:${type};base64,${Buffer.from(bytes).toString("base64")}`;
  } catch {
    return null;
  }
}

/* Static rendering of components/yokai-card.tsx; sizes follow styles/cards.css. */
export function ShareCard({
  card,
  colors,
  image,
  width
}: {
  card: SharedCard;
  colors: CardColors;
  image: string | null;
  width: number;
}) {
  const px = (value: number) => (value * width) / 300;
  const inset = px(colors.inset);
  const shadow = `0 ${px(1)}px ${px(2)}px #000, 0 0 ${px(12)}px #000`;
  const badge = {
    display: "flex",
    alignItems: "center",
    height: px(20),
    padding: `0 ${px(6)}px`,
    borderRadius: px(4),
    border: `${px(1)}px solid`,
    fontSize: px(13),
    letterSpacing: px(0.8)
  };
  const glow = colors.glow ?? "rgba(4,0,11,.7)";
  return (
    <div
      style={{
        display: "flex",
        flexShrink: 0,
        width,
        height: width * 1.4,
        padding: inset,
        borderRadius: px(12),
        background: colors.frame,
        boxShadow: `0 0 0 ${px(1)}px ${colors.glow ?? "transparent"}, 0 ${px(10)}px ${px(30)}px ${glow}`
      }}
    >
      <div
        style={{
          display: "flex",
          position: "relative",
          flex: 1,
          overflow: "hidden",
          borderRadius: px(10),
          background: colors.background
        }}
      >
        {image && (
          <img
            alt=""
            src={image}
            width={width - inset * 2}
            height={width * 1.4 - inset * 2}
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              width: "100%",
              height: "100%",
              objectFit: "cover"
            }}
          />
        )}
        <div
          style={{
            display: "flex",
            position: "absolute",
            left: 0,
            top: 0,
            width: "100%",
            height: "100%",
            backgroundImage:
              "linear-gradient(to bottom, rgba(0,0,0,.78) 0%, rgba(0,0,0,.34) 14%, transparent 30%, transparent 58%, rgba(0,0,0,.48) 76%, rgba(0,0,0,.94) 100%)"
          }}
        />
        {colors.line !== "transparent" && (
          <div
            style={{
              display: "flex",
              position: "absolute",
              left: px(12),
              top: px(12),
              right: px(12),
              bottom: px(12),
              border: `${px(1)}px solid ${colors.line}`,
              borderRadius: px(7)
            }}
          />
        )}
        <div
          style={{
            display: "flex",
            position: "absolute",
            left: 0,
            top: 0,
            width: "100%",
            height: "100%",
            flexDirection: "column",
            justifyContent: "space-between",
            padding: px(18)
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: px(4)
            }}
          >
            <span
              style={{
                display: "flex",
                fontSize: px(12),
                letterSpacing: px(1.2),
                textTransform: "uppercase",
                color: ink[1],
                textShadow: shadow
              }}
            >
              {card.category ?? ""}
            </span>
            <div style={{ display: "flex", gap: px(6) }}>
              <span
                style={{
                  ...badge,
                  background: colors.badge,
                  color: colors.badgeInk,
                  borderColor: colors.badgeBorder
                }}
              >
                {card.rarity}
              </span>
              {colors.special && (
                <span
                  style={{
                    ...badge,
                    background: colors.special.background,
                    color: colors.special.color,
                    borderColor: colors.special.color
                  }}
                >
                  <svg
                    width={px(colors.special.kind === "evolved" ? 16 : 12)}
                    height={px(12)}
                    viewBox={
                      colors.special.kind === "evolved"
                        ? "0 4 24 16"
                        : "0 0 24 24"
                    }
                  >
                    {colors.special.kind === "evolved" ? (
                      <path
                        d="M6 16c5 0 7-8 12-8a4 4 0 0 1 0 8c-5 0-7-8-12-8a4 4 0 1 0 0 8Z"
                        fill="none"
                        stroke={colors.special.color}
                        strokeWidth="2.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    ) : (
                      <path
                        d="M12 0c1 7 5 11 12 12-7 1-11 5-12 12-1-7-5-11-12-12 7-1 11-5 12-12Z"
                        fill={colors.special.color}
                      />
                    )}
                  </svg>
                </span>
              )}
            </div>
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: px(2)
            }}
          >
            <span
              style={{
                display: "flex",
                fontFamily: "Cinzel",
                fontSize: px(20),
                letterSpacing: px(0.8),
                color: "#fff",
                textShadow: shadow,
                textAlign: "center"
              }}
            >
              {card.cardName}
            </span>
            {card.franchise && (
              <span
                style={{
                  display: "flex",
                  fontSize: px(12),
                  letterSpacing: px(0.7),
                  color: "rgba(255,255,255,.88)",
                  textShadow: shadow
                }}
              >
                {formatLicenseName(card.franchise)}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function RarityPill({
  label,
  color,
  size
}: {
  label: string;
  color: string;
  size: number;
}) {
  return (
    <span
      style={{
        display: "flex",
        flexShrink: 0,
        whiteSpace: "nowrap",
        padding: `${size * 0.45}px ${size * 1.1}px`,
        border: `2px solid ${color}`,
        borderRadius: 999,
        background: "rgba(4,0,11,.55)",
        color,
        fontSize: size,
        letterSpacing: size * 0.16
      }}
    >
      {label}
    </span>
  );
}

export async function renderSharedCardImage(
  card: SharedCard,
  format: ShareImageFormat
) {
  const [{ width, height }, fonts, cinzel, brand, colors, image] =
    await Promise.all([
      Promise.resolve(sizes[format]),
      font,
      nameFont,
      logo,
      rarityTokens(card.rarity, card.shiny, card.isEvolved),
      fetchCatalogueImage(card.catalogueImageUrl)
    ]);
  const label = cardRarityLabel(
    card.rarity,
    card.shiny,
    card.isEvolved
  ).toUpperCase();
  const host = siteHost();
  const logoImage = (logoWidth: number) => (
    <img
      alt=""
      src={brand}
      width={logoWidth}
      height={Math.round((logoWidth * 941) / 1672)}
    />
  );
  const cardArt = (cardWidth: number) => (
    <ShareCard card={card} colors={colors} image={image} width={cardWidth} />
  );
  const domain = (size: number) => (
    <span style={{ display: "flex", fontSize: size, color: ink[2] }}>
      Collect yours on&nbsp;
      <span style={{ color: "#E8C26A" }}>{host}</span>
    </span>
  );
  const owner = (size: number) =>
    card.pseudo ? (
      <span style={{ display: "flex", fontSize: size, color: ink[2] }}>
        Shared by&nbsp;<span style={{ color: ink[1] }}>{card.pseudo}</span>
      </span>
    ) : null;
  const layouts = {
    story: (
      <div
        style={{
          display: "flex",
          width: "100%",
          height: "100%",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "space-between"
        }}
      >
        {logoImage(380)}
        {cardArt(700)}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 26
          }}
        >
          <RarityPill label={label} color={colors.label} size={30} />
          {owner(32)}
        </div>
        {domain(32)}
      </div>
    ),
    square: (
      <div
        style={{
          display: "flex",
          width: "100%",
          height: "100%",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "space-between"
        }}
      >
        <div
          style={{
            display: "flex",
            width: "100%",
            alignItems: "center",
            justifyContent: "space-between"
          }}
        >
          {logoImage(200)}
          <RarityPill label={label} color={colors.label} size={22} />
        </div>
        {cardArt(520)}
        <div
          style={{
            display: "flex",
            width: "100%",
            justifyContent: card.pseudo ? "space-between" : "center"
          }}
        >
          {owner(24)}
          {domain(24)}
        </div>
      </div>
    ),
    og: (
      <div
        style={{
          display: "flex",
          width: "100%",
          height: "100%",
          alignItems: "center",
          gap: 64
        }}
      >
        {cardArt(370)}
        <div
          style={{
            display: "flex",
            flex: 1,
            minWidth: 0,
            alignSelf: "stretch",
            flexDirection: "column",
            justifyContent: "center"
          }}
        >
          {logoImage(200)}
          <div
            style={{
              display: "flex",
              marginTop: 30,
              fontFamily: "Cinzel",
              fontSize: card.cardName.length > 16 ? 50 : 66,
              lineHeight: 1.05,
              letterSpacing: 2,
              color: ink[1]
            }}
          >
            {card.cardName}
          </div>
          {card.franchise && (
            <div
              style={{
                display: "flex",
                marginTop: 12,
                fontSize: 28,
                color: ink[2]
              }}
            >
              {formatLicenseName(card.franchise)}
            </div>
          )}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 20,
              marginTop: 28
            }}
          >
            <RarityPill label={label} color={colors.label} size={20} />
            {owner(22)}
          </div>
          <div style={{ display: "flex", marginTop: 40 }}>{domain(22)}</div>
        </div>
      </div>
    )
  };
  const response = new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        padding: format === "story" ? "96px 80px 88px" : 64,
        color: ink[1],
        fontFamily: "Sora",
        backgroundColor: "#060913",
        backgroundImage: `radial-gradient(circle at ${format === "og" ? "22% 50%" : "50% 50%"}, ${colors.glow ?? "rgba(68,106,181,.32)"} 0%, transparent 46%), radial-gradient(circle at 50% 0%, #111d30 0%, transparent 70%)`
      }}
    >
      {layouts[format]}
    </div>,
    {
      width,
      height,
      fonts: [
        { name: "Sora", data: fonts, weight: 700, style: "normal" },
        { name: "Cinzel", data: cinzel, weight: 700, style: "normal" }
      ]
    }
  );
  return new Uint8Array(await response.arrayBuffer());
}
