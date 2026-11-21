import { timingSafeEqual } from "node:crypto";
import { BillingError } from "@/lib/billing/config";
import { billingFailure, billingReply } from "@/lib/billing/http";
import { sandboxWhopWebhook } from "@/lib/billing/whop-webhook";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const webhook = sandboxWhopWebhook();
    const secret = process.env.WHOP_SANDBOX_RECONCILIATION_SECRET ?? "";
    const expected = Buffer.from("Bearer " + secret);
    const supplied = Buffer.from(request.headers.get("authorization") ?? "");
    if (
      secret.length < 32 ||
      supplied.length !== expected.length ||
      !timingSafeEqual(supplied, expected)
    )
      throw new BillingError("BILLING_AUTH_REQUIRED", 401);
    return billingReply(await webhook.drain());
  } catch (error) {
    return billingFailure(error, "reconcile");
  }
}
