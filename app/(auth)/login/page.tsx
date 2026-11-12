import { getTranslations } from "next-intl/server";
import Link from "next/link";
import type { Metadata } from "next";
import { AuthForm } from "@/components/auth-form";
import { AuthExperience } from "@/components/auth-experience";
import { OAuthButtons } from "@/components/oauth-buttons";
import { oauthCallbackMessage } from "@/lib/auth/oauth";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("metadata");
  return {
    title: t("signIn"),
    description: t("signInToYokkaiCollecToExploreYour")
  };
}

export default async function SignInPage({
  searchParams
}: {
  searchParams: Promise<{
    account?: string;
    confirmation?: string;
    oauth?: string;
    "mot-de-passe"?: string;
  }>;
}) {
  const t = await getTranslations("page");
  const authT = await getTranslations("authForm");
  const appeals = await getTranslations("sanctionAppeals");
  const {
    account,
    confirmation,
    oauth,
    "mot-de-passe": passwordStatus
  } = await searchParams;
  const oauthError = oauthCallbackMessage(oauth);
  return (
    <AuthExperience infinityPreview>
      <p className="eyebrow">{t("theHuntContinues")}</p>
      <h1 className="yk-auth-title">{t("welcomeBack")}</h1>
      <p className="yk-auth-intro">
        {t("yourCollectionAwaitsStepBackIntoTheAdventure")}
      </p>
      {account === "banned" && (
        <p role="alert" className="yk-auth-notice">
          {t("yourAccountIsBannedYouHaveBeenSignedOut")}
        </p>
      )}
      {passwordStatus === "modifie" && (
        <p role="status" className="yk-auth-notice">
          {t("yourPasswordHasBeenUpdatedYouCanNowSignIn")}
        </p>
      )}
      {oauthError && (
        <p role="alert" className="auth-error yk-auth-oauth-error">
          {authT(
            (
              {
                denied: "oauthDenied",
                "verify-email": "oauthVerifyEmail",
                service: "oauthService",
                error: "oauthError"
              } as Record<string, string>
            )[oauth!]
          )}
        </p>
      )}
      <OAuthButtons />
      <AuthForm
        mode="signin"
        confirmationError={confirmation === "erreur"}
        confirmationUnavailable={confirmation === "service"}
      />
      <Link
        href="/appeal"
        className="mt-4 inline-block text-sm text-cyan-200 underline"
      >
        {appeals("tokenAccess")}
      </Link>
    </AuthExperience>
  );
}
