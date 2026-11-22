import { BillingError } from "@/lib/billing/config";
import { getLocale } from "next-intl/server";
import { configuredBillingService } from "@/lib/billing/checkout-service";
import { consumeBillingRequest } from "@/lib/billing/rate-limit";
import {
  billingUser,
  emptyBillingInput,
  billingReply,
  billingFailure
} from "@/lib/billing/http";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const hasBlackoutOffer =
      new URL(request.url).searchParams.get("offer") === "blackout";
    const { blackFridayTerms } = hasBlackoutOffer
      ? await import("@/lib/data/blackout-preview")
      : {};
    if (blackFridayTerms) {
      const { whopCheckoutEnabled } =
        await import("@/lib/billing/whop-live.mjs");
      const now = Date.now();
      if (
        !whopCheckoutEnabled() ||
        process.env.WHOP_LIVE_SYNC_ENABLED !== "true" ||
        now < Date.parse(blackFridayTerms.startsAt) ||
        now >= Date.parse(blackFridayTerms.endsAt)
      )
        throw new BillingError("BILLING_CHECKOUT_CLOSED", 404);
    }
    const user = await billingUser(request, true);
    await emptyBillingInput(request);
    await consumeBillingRequest(user.id, "checkout");
    const checkout = await configuredBillingService().checkout(
      user.id,
      (await getLocale()) === "fr" ? "fr" : "en"
    );
    if (!blackFridayTerms) return billingReply({ url: checkout });

    const url = new URL(checkout);
    if (
      url.origin !== "https://whop.com" ||
      url.username ||
      url.password ||
      !/^[/]checkout[/]ch_[A-Za-z0-9]+$/.test(url.pathname)
    )
      throw new BillingError("BILLING_UNAVAILABLE");
    url.searchParams.set("promoCode", blackFridayTerms.promoCode);
    return billingReply({ url: url.href });
  } catch (error) {
    return billingFailure(error, "checkout");
  }
}
