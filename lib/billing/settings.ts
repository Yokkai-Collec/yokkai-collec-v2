import "server-only";
import { billingConfig, BillingError } from "./config";
import { configuredBillingService } from "./checkout-service";
import { consumeBillingRequest } from "./rate-limit";
import type { SubscriptionState } from "./subscription";

export type BillingStatus = SubscriptionState & {
  hasCustomer: boolean;
  provider?: "whop";
};
export type BillingSettings = {
  enabled: boolean;
  checkoutEnabled: boolean;
  checkoutProvider?: "whop";
  sandbox: boolean;
  status: BillingStatus | null;
  unavailable: boolean;
};

// Only safe presentation data crosses the server/client boundary.
export async function getBillingSettings(
  userId: string
): Promise<BillingSettings> {
  const result: BillingSettings = {
    enabled: false,
    checkoutEnabled: false,
    sandbox: false,
    status: null,
    unavailable: false
  };
  try {
    const config = billingConfig();
    result.enabled = true;
    if (
      config.live &&
      process.env.WHOP_LIVE_SYNC_ENABLED === "true" &&
      process.env.WHOP_LIVE_CHECKOUT_ENABLED === "true"
    )
      result.checkoutProvider = "whop";
    result.checkoutEnabled =
      result.checkoutProvider === "whop" || config.checkoutEnabled;
    result.sandbox = !config.live;
    // SSR reads share the durable API quota; reject before constructing the provider.
    await consumeBillingRequest(userId, "status");
    result.status = await configuredBillingService().status(userId);
  } catch (error) {
    result.unavailable = !(
      error instanceof BillingError && error.code === "BILLING_DISABLED"
    );
  }
  return result;
}
