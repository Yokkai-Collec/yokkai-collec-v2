import { getTranslations } from "next-intl/server";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  blackoutPreviewEnabled,
  blackFridayTerms
} from "@/lib/data/blackout-preview";
import { boosterOpeningDocument } from "@/lib/ui/booster-opening-document";

export const runtime = "nodejs";
let asset: Promise<string> | undefined;

export async function GET(request: Request) {
  const headers = {
    "Cache-Control": "no-store",
    "X-Robots-Tag": "noindex, nofollow",
    "Content-Type": "text/plain; charset=utf-8",
    "X-Content-Type-Options": "nosniff"
  };
  if (request.url.length > 512)
    return new Response(
      (await getTranslations("openingErrors"))("invalidRequest"),
      { status: 400, headers }
    );
  const url = new URL(request.url);
  const kind = url.searchParams.get("kind");
  const now = Date.now();
  const blackoutAvailable =
    blackoutPreviewEnabled ||
    (now >= Date.parse(blackFridayTerms.startsAt) &&
      now < Date.parse(blackFridayTerms.endsAt));
  if (
    kind !== "regular" &&
    kind !== "decision" &&
    kind !== "sunset" &&
    (kind !== "blackout" || !blackoutAvailable)
  )
    return new Response(
      (await getTranslations("openingErrors"))("invalidKind"),
      { status: 400, headers }
    );
  try {
    // Next's internal request URL can be localhost behind the production proxy.
    // Use the configured public origin, never an untrusted forwarded header.
    let parentOrigin =
      process.env?.NODE_ENV === "production" && process.env.NEXT_PUBLIC_SITE_URL
        ? new URL(process.env.NEXT_PUBLIC_SITE_URL).origin
        : url.origin;
    // Next can normalize a local 127.0.0.1 request to localhost internally.
    // The sandbox handshake needs the actual browser origin.
    if (process.env?.NODE_ENV === "development" && url.protocol === "http:") {
      const host = request.headers.get("host") ?? "";
      if (/^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/.test(host)) {
        const localOrigin = new URL(`http://${host}`);
        if (localOrigin.port === url.port) parentOrigin = localOrigin.origin;
      }
    }
    asset ??= readFile(
      join(process.cwd(), "data/booster-opening/reveal.html"),
      "utf8"
    ).catch(error => {
      asset = undefined;
      throw error;
    });
    return new Response(
      boosterOpeningDocument(
        await asset,
        parentOrigin,
        kind,
        url.searchParams.get("gesture") === "click",
        url.searchParams.get("back")
      ),
      {
        headers
      }
    );
  } catch {
    return new Response(
      (await getTranslations("openingErrors"))("unavailable"),
      {
        status: 400,
        headers
      }
    );
  }
}
