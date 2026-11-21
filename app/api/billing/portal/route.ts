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
    await consumeBillingRequest(user.id, "portal");
    return billingReply({
      url: await configuredBillingService().portal(user.id)
    });
  } catch (error) {
    return billingFailure(error, "portal");
  }
}
