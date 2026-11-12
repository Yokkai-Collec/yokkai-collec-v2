import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/utils/supabase/server";
import { applyFarmAssetRecoveryAction } from "./actions";

export async function FarmAssetPreview({
  cluster,
  kind,
  asset
}: {
  cluster: string;
  kind: "CARD" | "SALE";
  asset: string;
}) {
  const client = createClient(await cookies());
  const [{ data, error }, t] = await Promise.all([
    client.rpc("admin_preview_anticheat_asset_recovery", {
      p_cluster: cluster,
      p_kind: kind,
      p_asset: asset
    }),
    getTranslations("adminSecurity")
  ]);
  const plan = data as {
    eligible: boolean;
    enabled: boolean;
    protectedHolder: boolean;
    reserved: boolean;
    token: string;
    credited: number;
    recoverable: number;
    unrecoverable: number;
  } | null;
  return (
    <section
      id="farm-asset-preview"
      className="mt-4 scroll-mt-28 rounded-lg border border-cyan-400/30 p-3"
    >
      <h3 className="font-semibold">{t("clusters.assetPreview")}</h3>
      {error || !plan ? (
        <p className="text-sm">{t("clusters.assetUnavailable")}</p>
      ) : (
        <>
          <p className="break-all text-sm">{asset}</p>
          {plan.protectedHolder && (
            <p className="text-sm">{t("clusters.protectedHolder")}</p>
          )}
          {plan.reserved && (
            <p className="text-sm">{t("clusters.assetReserved")}</p>
          )}
          {kind === "SALE" && (
            <p className="text-sm">
              {t("clusters.assetAmounts", {
                credited: plan.credited,
                recoverable: plan.recoverable,
                unrecoverable: plan.unrecoverable
              })}
            </p>
          )}
          {plan.eligible && plan.enabled ? (
            <form
              action={applyFarmAssetRecoveryAction}
              className="mt-3 grid gap-2"
            >
              <input type="hidden" name="cluster" value={cluster} />
              <input type="hidden" name="kind" value={kind} />
              <input type="hidden" name="asset" value={asset} />
              <input type="hidden" name="token" value={plan.token} />
              <textarea
                name="reason"
                required
                minLength={10}
                maxLength={500}
                className="yk-field-control w-full"
                aria-label={t("quarantines.reason")}
                placeholder={t("quarantines.reason")}
              />
              <button className="yk-button min-h-11">
                {t("clusters.recoverAsset")}
              </button>
            </form>
          ) : (
            <p className="text-sm">{t("clusters.assetUnavailable")}</p>
          )}
        </>
      )}
    </section>
  );
}
