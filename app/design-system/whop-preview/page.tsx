import { notFound } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";
import { getCurrentUser } from "@/lib/auth/session";
import { whopSandboxConfig } from "@/lib/billing/whop-sandbox";
import { WhopSandboxPreview } from "@/components/whop-sandbox-preview";

export const dynamic = "force-dynamic";

export default async function Page() {
  if (!whopSandboxConfig()) notFound();
  const [user, messages] = await Promise.all([getCurrentUser(), getMessages()]);
  return (
    <NextIntlClientProvider messages={{ whopSandbox: messages.whopSandbox }}>
      <WhopSandboxPreview signedIn={!!user} />
    </NextIntlClientProvider>
  );
}
