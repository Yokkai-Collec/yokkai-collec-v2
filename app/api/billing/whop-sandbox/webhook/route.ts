import { after } from "next/server";
import { billingBytes, billingFailure, billingReply } from "@/lib/billing/http";
import { logBillingFailure } from "@/lib/billing/observability";
import { sandboxWhopWebhook } from "@/lib/billing/whop-webhook";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const webhook = sandboxWhopWebhook();
    const eventId = await webhook.enqueue(
      await billingBytes(request),
      request.headers
    );
    if (eventId)
      after(async () => {
        try {
          await webhook.drain(eventId);
        } catch (error) {
          logBillingFailure("webhook", error);
        }
      });
    return billingReply({ received: true });
  } catch (error) {
    return billingFailure(error, "webhook");
  }
}
