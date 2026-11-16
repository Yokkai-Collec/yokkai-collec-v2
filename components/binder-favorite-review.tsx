"use client";
import { formatLicenseName } from "@/lib/ui/license-name";
import { gameErrorKey } from "@/i18n/game-messages";
import { useTranslations, useFormatter } from "next-intl";

import { useState } from "react";
import type { FavoriteConflict } from "@/lib/data/binders";

export function BinderFavoriteReview({
  conflicts,
  resolve
}: {
  conflicts: FavoriteConflict[];
  resolve: (license: string, keys: string[]) => Promise<void>;
}) {
  const tError = useTranslations();
  const tv = useTranslations("catalogueUi");
  const format = useFormatter();
  const [choices, setChoices] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  return (
    <details className="yk-binder-favorite-review">
      <summary>{tv("reviewFavorites", { count: conflicts.length })}</summary>
      <p>{tv("somePreviousFavoritesMatchMoreThanOneBinder")}</p>
      {conflicts.map(conflict => (
        <fieldset key={conflict.license} disabled={busy !== null}>
          <legend>{formatLicenseName(conflict.license)}</legend>
          {conflict.candidates.map(candidate => (
            <label key={candidate.binderKey}>
              <input
                type="checkbox"
                checked={(choices[conflict.license] ?? []).includes(
                  candidate.binderKey
                )}
                onChange={event => {
                  const checked = event.target.checked;
                  setChoices(current => ({
                    ...current,
                    [conflict.license]: checked
                      ? [
                          ...(current[conflict.license] ?? []),
                          candidate.binderKey
                        ]
                      : (current[conflict.license] ?? []).filter(
                          key => key !== candidate.binderKey
                        )
                  }));
                }}
              />
              <span>
                {formatLicenseName(candidate.license)}
                {candidate.total !== undefined && (
                  <small className="yk-binder-origin">
                    {candidate.category ? `${candidate.category} · ` : ""}
                    {format.number(candidate.total)}{" "}
                    {candidate.total === 1
                      ? tv("countPluralOneCardOtherCards", {
                          count: candidate.total
                        })
                      : tv("countPluralOneCardOtherCards", {
                          count: candidate.total
                        })}
                  </small>
                )}
              </span>
            </label>
          ))}
          <button
            type="button"
            onClick={async () => {
              setBusy(conflict.license);
              setError("");
              try {
                await resolve(
                  conflict.license,
                  choices[conflict.license] ?? []
                );
              } catch (reason) {
                setError(
                  reason instanceof Error
                    ? gameErrorKey(reason)
                    : "catalogueUi.couldntSaveTheseFavorites"
                );
              } finally {
                setBusy(null);
              }
            }}
          >
            {busy === conflict.license
              ? tv("saving")
              : tv("saveFavoriteChoices")}
          </button>
        </fieldset>
      ))}
      {error && <p role="alert">{tError(gameErrorKey(error))}</p>}
    </details>
  );
}
