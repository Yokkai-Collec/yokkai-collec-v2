"use client";
import { formatLicenseName } from "@/lib/ui/license-name";
import { useCallback } from "react";
import { useTranslations } from "next-intl";
import { RankingChoice } from "@/components/ranking-choice";
import { type PaniniAlbumProgress } from "@/lib/data/cards";
import { getRankingLicenseChoices } from "@/lib/leaderboard/choices";
import { binderIdentity } from "@/lib/ui/binder-identity";
import { normalizeChoiceLabel } from "@/lib/ui/select-typeahead";
const licenseLabel = (item: PaniniAlbumProgress) =>
  formatLicenseName(item.license);
export function LicenseRankingChoice({
  items,
  selected,
  loading,
  hasMore,
  onLoadMore,
  onSelect,
  category = "",
  query = ""
}: {
  items: PaniniAlbumProgress[];
  selected: PaniniAlbumProgress | null;
  loading: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
  onSelect: (item: PaniniAlbumProgress) => void;
  category?: string;
  query?: string;
}) {
  const t = useTranslations("communityRanking");
  const findMatches = useCallback(
    async (prefix: string, signal: AbortSignal) => {
      // Keep a bounded group of matches locally, so subsequent letters and
      // repeated-letter cycling do not need another round trip.
      const next = await getRankingLicenseChoices({
        query,
        prefix,
        category,
        pageSize: 72,
        signal
      });
      if (signal.aborted) return [];
      return next.items.filter(item =>
        normalizeChoiceLabel(item.license).startsWith(prefix)
      );
    },
    [category, query]
  );
  return (
    <RankingChoice
      id="ranking-license-select"
      labelId="ranking-license-label"
      sortByLabel
      items={items}
      selected={selected}
      getKey={binderIdentity}
      getLabel={licenseLabel}
      placeholder={t("chooseLicense")}
      loading={loading}
      hasMore={hasMore}
      onLoadMore={onLoadMore}
      onSelect={onSelect}
      findMatches={hasMore ? findMatches : undefined}
      loadingLabel={t("selectionLoading")}
      emptyLabel={t("noLicenses")}
      errorLabel={t("selectionFailed")}
    />
  );
}
