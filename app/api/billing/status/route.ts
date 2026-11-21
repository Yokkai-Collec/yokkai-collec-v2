import { configuredBillingService } from "@/lib/billing/checkout-service";
import { consumeBillingRequest } from "@/lib/billing/rate-limit";
import { billingUser, billingReply, billingFailure } from "@/lib/billing/http";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    const user = await billingUser(request);
    await consumeBillingRequest(user.id, "status");
    return billingReply(await configuredBillingService().status(user.id));
  } catch (error) {
    return billingFailure(error, "status");
  }
}
