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
    const user = await billingUser(request, true);
    await emptyBillingInput(request);
    await consumeBillingRequest(user.id, "checkout");
    return billingReply({
      url: await configuredBillingService().checkout(
        user.id,
        (await getLocale()) === "fr" ? "fr" : "en"
      )
    });
  } catch (error) {
    return billingFailure(error, "checkout");
  }
}
