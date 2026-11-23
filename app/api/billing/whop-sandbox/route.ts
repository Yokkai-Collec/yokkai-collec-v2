import { getCurrentUser } from "@/lib/auth/session";
import { BillingError } from "@/lib/billing/config";
import {
  billingFailure,
  billingReply,
  emptyBillingInput
} from "@/lib/billing/http";
import {
  whopSandboxConfig,
  whopSandboxService
} from "@/lib/billing/whop-sandbox";

export const runtime = "nodejs";

async function run(request: Request, checkout: boolean) {
  try {
    const config = whopSandboxConfig();
    if (!config) throw new BillingError("BILLING_DISABLED", 404);
    if (
      request.headers.get("host") !== new URL(config.origin).host ||
      (checkout &&
        (request.headers.get("origin") !== config.origin ||
          request.headers.get("sec-fetch-site") === "cross-site"))
    )
      throw new BillingError("BILLING_REQUEST_DENIED", 403);
    const user = await getCurrentUser();
    if (!user) throw new BillingError("BILLING_AUTH_REQUIRED", 401);
    const billing = whopSandboxService(config);
    if (checkout) {
      await emptyBillingInput(request);
      const checkoutUrl = await billing.checkout(user.id);
      if (new URL(request.url).searchParams.get("offer") !== "blackout")
        return billingReply({ url: checkoutUrl });

      const { blackFridayTerms } = await import("@/lib/data/blackout-preview");
      const url = new URL(checkoutUrl);
      url.searchParams.set("promoCode", blackFridayTerms.promoCode);
      return billingReply({ url: url.href });
    }
    return billingReply(await billing.status(user.id));
  } catch (error) {
    return billingFailure(error, checkout ? "checkout" : "status");
  }
}

export async function POST(request: Request) {
  return run(request, true);
}

export async function GET(request: Request) {
  return run(request, false);
}
