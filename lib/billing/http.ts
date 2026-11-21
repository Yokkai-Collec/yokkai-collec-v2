import "server-only";
import { timingSafeEqual } from "node:crypto";
import { getCurrentUser } from "@/lib/auth/session";
import { billingConfig, BillingError } from "./config";
import { BillingRateLimitError } from "./rate-limit";
import { logBillingFailure, type BillingOperation } from "./observability";

export function billingReply(body: object, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff"
    }
  });
}
export function billingFailure(
  error: unknown,
  operation: BillingOperation = "request"
) {
  logBillingFailure(operation, error);
  const known = error instanceof BillingError;
  const status = known ? error.status : 503;
  const response = billingReply(
    {
      code: known ? error.code : "BILLING_UNAVAILABLE",
      error:
        status === 401
          ? "Sign in to continue."
          : status === 404
            ? "Not found."
            : status === 429
              ? "Too many requests. Please try again shortly."
              : "Billing is temporarily unavailable. Please try again."
    },
    status
  );
  if (error instanceof BillingRateLimitError)
    response.headers.set("Retry-After", String(error.retryAfterSeconds));
  return response;
}
export async function billingUser(request: Request, mutate = false) {
  const config = billingConfig();
  if (
    mutate &&
    (request.headers.get("origin") !== config.origin ||
      request.headers.get("sec-fetch-site") === "cross-site")
  )
    throw new BillingError("BILLING_REQUEST_DENIED", 403);
  const user = await getCurrentUser();
  if (!user) throw new BillingError("BILLING_AUTH_REQUIRED", 401);
  return user;
}
export async function billingBytes(request: Request, limit = 262144) {
  const reader = request.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new BillingError("BILLING_INVALID_REQUEST", 413);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}
export async function billingBody(request: Request, limit = 262144) {
  return (await billingBytes(request, limit)).toString("utf8");
}
export async function emptyBillingInput(request: Request) {
  if (
    request.headers.get("content-type")?.split(";")[0].trim() !==
    "application/json"
  )
    throw new BillingError("BILLING_INVALID_REQUEST", 400);
  let input;
  try {
    input = JSON.parse(await billingBody(request, 1024));
  } catch {
    throw new BillingError("BILLING_INVALID_REQUEST", 400);
  }
  if (
    !input ||
    Array.isArray(input) ||
    typeof input !== "object" ||
    Object.keys(input).length
  )
    throw new BillingError("BILLING_INVALID_REQUEST", 400);
}
export function requireBillingReconciliation(request: Request) {
  billingConfig();
  const secret = process.env.STRIPE_RECONCILIATION_SECRET ?? "";
  const header = request.headers.get("authorization") ?? "";
  const expected = Buffer.from(`Bearer ${secret}`),
    supplied = Buffer.from(header);
  if (
    secret.length < 32 ||
    supplied.length !== expected.length ||
    !timingSafeEqual(supplied, expected)
  )
    throw new BillingError("BILLING_AUTH_REQUIRED", 401);
}
