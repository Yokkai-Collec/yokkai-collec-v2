import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const supabaseImageOrigin = process.env.NEXT_PUBLIC_SUPABASE_URL
  ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL)
  : undefined;

// Explicit existing files only: a missing URL must not cache a personalized
// not-found page. Keep this list in sync with public/assets (tested below).
const publicArtwork = [
  "booster-pack.png",
  "brand-logo-blue.png",
  "brand-logo-bubble.png",
  "brand-logo-chrome.png",
  "brand-logo-ice-retro.png",
  "bubble-card-back-v1.png",
  "bubble-decisive-booster-v1.png",
  "bubble-regular-booster-v1.png",
  "card-back.png",
  "chrome-decision-booster-v1.png",
  "chrome-regular-booster-v1.png",
  "decision-booster-pack.png",
  "decision-opening-nebula.webp",
  "ev-badge-lightning.svg",
  "ev-black-chrome-bold.svg",
  "ev-black-chrome.svg",
  "ev-electric-white.svg",
  "ev-lowercase-chrome.svg",
  "ev-titlecase-graphite.svg",
  "ex-chrome-lettering.svg",
  "header-logo-gold.png",
  "home-booster-box.webp",
  "regular-opening-nebula.webp",
  "yokkai-site-backdrop.webp"
];

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1", "192.168.100.20", "192.168.1.16"],
  poweredByHeader: false,
  devIndicators: false,
  images: {
    qualities: [75, 85], // Keep cached fronts' quality-75 requests valid.
    remotePatterns:
      supabaseImageOrigin?.protocol === "https:"
        ? [
            new URL(
              "/storage/v1/object/public/card-images/**",
              supabaseImageOrigin
            )
          ]
        : [],
    maximumRedirects: 0,
    // Replaced card images get a new URL, so optimized variants can be kept
    // for a day (Next default: 4 h). Fewer re-optimizations and RustFS reads.
    minimumCacheTTL: 86400
  },
  experimental: {
    // Keep visited dynamic pages 30 s in the client router cache (the Next 14
    // default): going back to a recent page no longer repeats the server
    // render and its Auth checks. Client components still reload their own
    // data on mount, and sign-in/sign-out Server Actions clear this cache.
    staleTimes: {
      dynamic: 30
    },
    serverActions: {
      bodySizeLimit: "8mb"
    }
  },
  async headers() {
    const isDev = process.env.NODE_ENV === "development";
    const supabase = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const origin = supabase ? new URL(supabase).origin : "";
    const connections = [
      origin,
      origin.replace(/^http/, "ws"),
      "https://api.giphy.com",
      "https://cloudflareinsights.com"
    ].filter(Boolean);
    // Static Next.js pages need inline hydration scripts and inline component styles.
    // Keep an explicit staging switch for hosts that have not validated the
    // enforced policy yet. Production enables CSP_ENFORCE at build time.
    const csp = [
      "default-src 'self'",
      `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""} https://static.cloudflareinsights.com https://challenges.cloudflare.com`,
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      `connect-src 'self' ${connections.join(" ")}${isDev ? " ws:" : ""}`,
      // Catalogue sources vary; custom images and share downloads also use HTTPS/blob/data.
      "img-src 'self' https: data: blob:",
      "font-src 'self' https://fonts.gstatic.com",
      // Custom card art: Imgur GIFs play as their lighter MP4.
      "media-src 'self' blob: https://i.imgur.com",
      "object-src 'none'",
      "base-uri 'self'",
      // Chromium also checks the destination of a form POST's redirect.
      "form-action 'self' https://discord.com https://x.com",
      "frame-src https://challenges.cloudflare.com",
      // report-uri for Firefox/Safari; report-to (Reporting API) for Chromium.
      "report-uri /api/security/csp-report",
      "report-to csp-endpoint"
    ].join("; ");
    const site = process.env.NEXT_PUBLIC_SITE_URL;
    const reportEndpoint = `${site?.startsWith("https://") ? new URL(site).origin : ""}/api/security/csp-report`;
    const enforced = [
      csp
        .replace(" https://fonts.googleapis.com", "")
        .replace(" https://fonts.gstatic.com", ""),
      "script-src-attr 'none'",
      "frame-ancestors 'none'"
    ].join("; ");
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy-Report-Only", value: csp },
          {
            key: "Reporting-Endpoints",
            value: `csp-endpoint="${reportEndpoint}"`
          },
          ...(process.env.CSP_ENFORCE === "true"
            ? [{ key: "Content-Security-Policy", value: enforced }]
            : []),
          { key: "Strict-Transport-Security", value: "max-age=31536000" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value:
              "camera=(), microphone=(), geolocation=(), payment=(), usb=()"
          }
        ]
      },
      // These files are public and identical for every visitor. Keep a bounded
      // TTL (no immutable directive): filenames are not content-versioned.
      {
        source: "/fonts/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=3600" }]
      },
      {
        source: "/assets/sfx/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=3600" }]
      },
      ...publicArtwork.map(file => ({
        source: "/assets/" + file,
        headers: [{ key: "Cache-Control", value: "public, max-age=3600" }]
      })),
      {
        // GoTrue fetches these templates; Cloudflare only injects scripts into text/html.
        source: "/auth-emails/:path*",
        headers: [{ key: "Content-Type", value: "text/plain; charset=utf-8" }]
      },
      {
        source: "/share/:path*",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }]
      }
    ];
  }
};

export default createNextIntlPlugin()(nextConfig);
