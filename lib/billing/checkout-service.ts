import "server-only";
import Stripe from "stripe";
import { billingConfig, BillingError, type BillingConfig } from "./config";
import { configuredBillingService as configuredStripe } from "./server";
import { billingStore } from "./store";
import { subscriptionState, type SubscriptionState } from "./subscription";

async function verifyStripeCheckoutCanSwitch(
  config: BillingConfig,
  userId: string
) {
  const store = billingStore(config);
  const account = await store.claim(userId);
  try {
    const review = () => new BillingError("BILLING_REVIEW_REQUIRED", 409);
    const manage = () => new BillingError("BILLING_USE_PORTAL", 409);
    if (
      account.risk_hold ||
      (account.customer_started_at && !account.stripe_customer_id) ||
      (account.checkout_started_at && !account.checkout_id)
    )
      throw review();
    if (!account.stripe_customer_id) return;
    const stripe = new Stripe(config.secret, {
      apiVersion: Stripe.API_VERSION,
      maxNetworkRetries: 1,
      timeout: 10000
    });
    if ((await stripe.accounts.retrieve(null)).id !== config.account)
      throw review();
    const subscriptions = await stripe.subscriptions.list({
      customer: account.stripe_customer_id,
      status: "all",
      limit: 100,
      expand: ["data.latest_invoice"]
    });
    if (
      subscriptions.data.some(
        s =>
          (typeof s.customer === "string" ? s.customer : s.customer.id) !==
          account.stripe_customer_id
      )
    )
      throw review();
    subscriptionState(subscriptions, config.price, config.live);
    if (
      subscriptions.data.some(
        s => s.status !== "canceled" && s.status !== "incomplete_expired"
      )
    )
      throw manage();
    if (!account.checkout_id) return;
    const session = await stripe.checkout.sessions.retrieve(
      account.checkout_id
    );
    if (
      session.livemode !== config.live ||
      session.customer !== account.stripe_customer_id ||
      session.client_reference_id !== userId
    )
      throw review();
    const subscription =
      typeof session.subscription === "string"
        ? session.subscription
        : session.subscription?.id;
    if (
      session.status !== "expired" &&
      !(
        session.status === "complete" &&
        subscriptions.data.some(s => s.id === subscription)
      )
    )
      throw manage();
  } finally {
    await store.release(account);
  }
}

export function configuredBillingService() {
  const config = billingConfig();
  const stripe = configuredStripe();
  if (!config.live || process.env.WHOP_LIVE_SYNC_ENABLED !== "true")
    return stripe;
  return {
    ...stripe,
    async status(
      userId: string
    ): Promise<
      SubscriptionState & { hasCustomer: boolean; provider?: "whop" }
    > {
      const { whopSubscriptionStatus } = await import("./whop-live.mjs");
      const whop = await whopSubscriptionStatus(userId);
      return whop ? { ...whop, provider: "whop" } : stripe.status(userId);
    },
    async checkout(userId: string, locale: "en" | "fr" = "en") {
      const { hasWhopCheckout, openWhopCheckout, whopCheckoutEnabled } =
        await import("./whop-live.mjs");
      if (!whopCheckoutEnabled()) {
        if (!config.checkoutEnabled)
          throw new BillingError("BILLING_CHECKOUT_CLOSED");
        if (await hasWhopCheckout(userId))
          throw new BillingError("BILLING_USE_PORTAL", 409);
        return stripe.checkout(userId, locale);
      }
      await verifyStripeCheckoutCanSwitch(config, userId);
      try {
        return await openWhopCheckout(userId);
      } catch (error) {
        if (error instanceof Error && error.message === "BILLING_USE_PORTAL")
          throw new BillingError("BILLING_USE_PORTAL", 409);
        throw error;
      }
    },
    async portal(userId: string) {
      const { whopManageUrl } = await import("./whop-live.mjs");
      return (await whopManageUrl(userId)) ?? stripe.portal(userId);
    }
  };
}
