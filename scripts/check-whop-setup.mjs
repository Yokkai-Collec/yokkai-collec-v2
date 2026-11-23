import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const apiVersion = "2026-11-20";
const apiOrigins = {
  sandbox: "https://sandbox-api.whop.com",
  production: "https://api.whop.com"
};

// Account and variant checks are read-only in both Whop environments.
export async function checkWhopSetup(env, request = fetch) {
  const mode = env.WHOP_MODE;
  const accountId = env.WHOP_ACCOUNT_ID ?? "";
  const planId = env.WHOP_PRO_PLAN_ID ?? "";
  const key = env.WHOP_API_KEY ?? "";
  if (
    !Object.hasOwn(apiOrigins, mode) ||
    !/^biz_[A-Za-z0-9]+$/.test(accountId) ||
    !/^plan_[A-Za-z0-9]+$/.test(planId) ||
    !key ||
    /\s/.test(key)
  )
    throw new Error("WHOP_SETUP_CONFIGURATION_INVALID");

  let variant;
  try {
    const response = await request(
      `${apiOrigins[mode]}/api/v1/variants/${planId}`,
      {
        method: "GET",
        redirect: "error",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${key}`,
          "Api-Version-Date": apiVersion
        },
        signal: AbortSignal.timeout(10000)
      }
    );
    if (!response.ok) throw new Error();
    variant = await response.json();
  } catch {
    throw new Error("WHOP_SETUP_PROVIDER_UNAVAILABLE");
  }

  if (variant?.account?.id !== accountId || variant.id !== planId)
    throw new Error("WHOP_SETUP_ACCOUNT_OR_PLAN_MISMATCH");

  const trialDays = mode === "sandbox" ? 3 : 0;
  const trialMatches =
    mode === "sandbox"
      ? variant.trial_period_days === trialDays
      : variant.trial_period_days === null ||
        variant.trial_period_days === trialDays;

  if (
    !/^prod_[A-Za-z0-9]+$/.test(variant.product?.id ?? "") ||
    !["visible", "hidden", "quick_link"].includes(variant.visibility) ||
    variant.release_method !== "buy_now" ||
    variant.billing_type !== "renewal" ||
    variant.billing_period !== 30 ||
    variant.currency !== "eur" ||
    variant.renewal_price !== 4.99 ||
    variant.initial_price !== 0 ||
    !trialMatches ||
    variant.tax_type !== "exclusive"
  )
    throw new Error("WHOP_SETUP_PLAN_TERMS_MISMATCH");

  return {
    verified: true,
    environment: mode,
    renewalAmountInCents: 499,
    currency: "eur",
    billingPeriodDays: 30,
    trialDays,
    taxType: "exclusive"
  };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    console.log(JSON.stringify(await checkWhopSetup(process.env)));
  } catch (error) {
    const code =
      error instanceof Error && /^WHOP_SETUP_[A-Z_]+$/.test(error.message)
        ? error.message
        : "WHOP_SETUP_FAILED";
    console.error(code);
    process.exitCode = 1;
  }
}
