import Link from "next/link";
import { getTranslations } from "next-intl/server";

export type SanctionQuarantineConflict = {
  id: string;
  cards: number;
  karas: number;
};

export async function SanctionQuarantineConflicts({
  conflicts
}: {
  conflicts?: SanctionQuarantineConflict[];
}) {
  if (!conflicts?.length) return null;
  const t = await getTranslations("adminSecurity");
  return (
    <div className="my-3 rounded-lg border border-amber-300/30 p-3 text-sm text-amber-100">
      <p>{t("quarantines.sanctionConflict")}</p>
      <ul className="mt-2 space-y-1">
        {conflicts.map(conflict => (
          <li className="break-words" key={conflict.id}>
            <Link
              className="underline"
              href={`/admin/security#quarantine-${conflict.id}`}
            >
              {t("quarantines.sanctionConflictCase", {
                id: conflict.id,
                cards: conflict.cards,
                karas: conflict.karas
              })}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
