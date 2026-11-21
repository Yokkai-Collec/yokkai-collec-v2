"use client";
import { useTranslations, useFormatter } from "next-intl";

import Link from "next/link";
import { useRef, useState } from "react";
import type { BillingSettings } from "@/lib/billing/settings";

export function PremiumCheckout({
  signedIn,
  billing
}: {
  signedIn: boolean;
  billing: BillingSettings | null;
}) {
  const tPr5 = useTranslations("premiumUi");
  const fmt = useFormatter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);
  const active =
    billing?.enabled && billing.status?.active && !billing.unavailable;
  const hasCustomer = billing?.status?.hasCustomer === true;
  const canCheckout =
    signedIn &&
    billing?.enabled === true &&
    billing.checkoutEnabled &&
    !billing.unavailable &&
    billing.status !== null &&
    !billing.status.active &&
    ["not_subscribed", "canceled", "incomplete_expired"].includes(
      billing.status.status
    );
  const manageSubscription = active || (hasCustomer && !canCheckout);
  const checkoutWithWhop = billing?.checkoutProvider === "whop";
  const displayWhop =
    billing?.status?.provider === "whop" ||
    (checkoutWithWhop && (!signedIn || canCheckout || !hasCustomer));

  async function openCheckout() {
    if (!canCheckout || pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}"
      });
      const result = await response.json();
      if (!response.ok) {
        setError(
          result.code === "BILLING_USE_PORTAL"
            ? "alreadyHasSubscription"
            : "billingUnavailable"
        );
        return;
      }
      const url = new URL(result.url);
      if (
        url.origin !==
          (checkoutWithWhop
            ? "https://whop.com"
            : "https://checkout.stripe.com") ||
        url.username ||
        url.password
      )
        throw Error("Invalid destination");
      window.location.assign(url.href);
    } catch {
      setError("billingUnavailable");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  return (
    <aside id="membership" className="yk-premium-price-card" aria-busy={busy}>
      <p className="eyebrow">{tPr5("yourMembership")}</p>
      <h2>Yokkai Pro</h2>
      <p className="yk-premium-price">
        {tPr5.rich(displayWhop ? "whopPriceEvery30Days" : "priceMonth", {
          price: fmt.number(4.99, { style: "currency", currency: "EUR" }),
          small0: chunks => <small>{chunks}</small>
        })}
      </p>
      {displayWhop && !active && <p>{tPr5("whopTrial")}</p>}
      <p>{tPr5("monthlySubscriptionCancelFromYourAccountSettings")}</p>
      {active && (
        <p className="text-success" role="status">
          {tPr5("proActive")}
        </p>
      )}
      {billing?.sandbox && <p role="status">{tPr5("testModeNoRealPayment")}</p>}
      {signedIn && !billing?.checkoutEnabled && !active && (
        <p>{tPr5("subscriptionsAreNotAvailableYet")}</p>
      )}
      {signedIn && billing?.unavailable && (
        <p role="alert">{tPr5("unableToVerifyYourSubscriptionRightNow")}</p>
      )}
      {error && (
        <p className="text-danger" role="alert">
          {tPr5(error)}
        </p>
      )}
      {manageSubscription ? (
        <Link
          className="yk-button yk-button-primary"
          href="/settings#subscription"
        >
          {tPr5("manageSubscription")}
        </Link>
      ) : signedIn ? (
        <button
          className="yk-button yk-button-primary"
          type="button"
          disabled={!canCheckout || busy}
          aria-busy={busy}
          onClick={() => void openCheckout()}
        >
          {busy
            ? tPr5(checkoutWithWhop ? "openingWhop" : "openingStripe")
            : tPr5("getPro")}
        </button>
      ) : (
        <Link
          className="yk-button yk-button-primary"
          href="/login?next=%2Fpremium"
        >
          {tPr5("gETPRO")}
        </Link>
      )}
      <p className="yk-pro-offer-footnote">
        {tPr5.rich(
          displayWhop
            ? "whopPayments"
            : "securePaymentsAndInvoicesWithStripeSee",
          {
            link1: chunks => (
              <Link href="/privacy" className="underline underline-offset-4">
                {chunks}
              </Link>
            )
          }
        )}
      </p>
    </aside>
  );
}
