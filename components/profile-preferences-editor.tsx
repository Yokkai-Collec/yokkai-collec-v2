"use client";
import { formatLicenseName } from "@/lib/ui/license-name";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { gameErrorKey } from "@/i18n/game-messages";
import { Button } from "@/components/ui";
import { ProfileLicensePicker } from "@/components/profile-license-picker";
import type {
  ProfileWidget,
  getProfileWidgetLicenses,
  saveProfileWidgets
} from "@/lib/data/profile";

export function PreferencesEditor({
  widgets,
  categories,
  loadLicenses,
  save,
  onSaved,
  labelCategory
}: {
  widgets: ProfileWidget[];
  categories: string[];
  loadLicenses: typeof getProfileWidgetLicenses;
  save: typeof saveProfileWidgets;
  onSaved: (value: ProfileWidget[]) => void;
  labelCategory: (category: string) => string;
}) {
  const t = useTranslations();
  const [values, setValues] = useState<ProfileWidget[]>(() =>
    widgets.map(widget => ({ ...widget, entries: [...widget.entries] }))
  );
  const [activeCategory, setActiveCategory] = useState(
    widgets[0]?.category ?? ""
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <form
      className="yk-profile-preferences-form"
      onSubmit={async event => {
        event.preventDefault();
        if (busy) return;
        const next = values;
        if (next.some(widget => widget.entries.length > 12)) {
          setError("Choose up to 12 licenses per category.");
          return;
        }
        setBusy(true);
        setError("");
        try {
          onSaved(await save(next));
        } catch (reason) {
          setError(
            reason instanceof Error ? reason.message : "Couldn't save changes."
          );
        } finally {
          setBusy(false);
        }
      }}
    >
      <p className="yk-profile-muted">{t("profileUi.licenseCategoryHint")} </p>
      <div
        className="yk-profile-widget-picker"
        aria-label={t("profileUi.availableCategories")}
      >
        {categories.map(category => {
          const selected = values.some(widget => widget.category === category);
          return (
            <button
              key={category}
              type="button"
              aria-pressed={selected}
              disabled={busy || (!selected && values.length >= 12)}
              onClick={() => {
                if (!selected)
                  setValues(current => [...current, { category, entries: [] }]);
                setActiveCategory(category);
              }}
            >
              <span aria-hidden="true">{selected ? "✓" : "+"}</span> {category}
            </button>
          );
        })}
      </div>
      {!categories.length && (
        <p className="yk-profile-empty">
          {t("profileUi.noCategoriesAvailableYet")}
        </p>
      )}
      {values.map((widget, index) => (
        <section
          className="yk-profile-widget-editor"
          data-editor-category={widget.category}
          key={widget.category}
        >
          <div className="yk-profile-section-heading">
            <h3>{labelCategory(widget.category)}</h3>
            <div className="yk-profile-widget-tools">
              {([-1, 1] as const).map(direction => (
                <button
                  key={direction}
                  type="button"
                  disabled={
                    busy ||
                    index + direction < 0 ||
                    index + direction >= values.length
                  }
                  aria-label={t("profileUi.moveWidget", {
                    direction: direction < 0 ? "up" : "down",
                    category: widget.category
                  })}
                  onClick={() =>
                    setValues(current => {
                      const next = [...current];
                      [next[index], next[index + direction]] = [
                        next[index + direction],
                        next[index]
                      ];
                      return next;
                    })
                  }
                >
                  {direction < 0 ? "↑" : "↓"}
                </button>
              ))}
              <button
                type="button"
                disabled={busy}
                aria-label={t("profileUi.removeWidget", {
                  category: widget.category
                })}
                onClick={() =>
                  setValues(current =>
                    current.filter(value => value.category !== widget.category)
                  )
                }
              >
                ×
              </button>
            </div>
          </div>
          <div
            className="yk-profile-selected-licenses"
            aria-label={t("profileUi.selectedLicenses", {
              category: widget.category
            })}
          >
            {widget.entries.map(license => (
              <button
                key={license}
                type="button"
                disabled={busy}
                aria-label={t("profileUi.removeFavorite", {
                  license: widget.labels?.[license] ?? license,
                  category: widget.category
                })}
                onClick={() =>
                  setValues(current =>
                    current.map(value =>
                      value.category === widget.category
                        ? {
                            ...value,
                            entries: value.entries.filter(
                              name => name !== license
                            )
                          }
                        : value
                    )
                  )
                }
              >
                {formatLicenseName(widget.labels?.[license] ?? license)}{" "}
                <span aria-hidden="true">×</span>
              </button>
            ))}
            {!widget.entries.length && (
              <p className="yk-profile-muted">
                {t("profileUi.noLicensesSelected")}
              </p>
            )}
          </div>
          <Button
            variant="secondary"
            disabled={busy}
            aria-expanded={activeCategory === widget.category}
            onClick={() =>
              setActiveCategory(
                activeCategory === widget.category ? "" : widget.category
              )
            }
          >
            {activeCategory === widget.category
              ? t("profileUi.hideLicenses")
              : t("profileUi.chooseLicenses")}
          </Button>
          {activeCategory === widget.category && (
            <ProfileLicensePicker
              key={widget.category}
              category={widget.category}
              selected={widget.entries}
              disabled={busy}
              load={loadLicenses}
              onToggle={(license, label) =>
                setValues(current =>
                  current.map(value =>
                    value.category === widget.category
                      ? {
                          ...value,
                          labels: {
                            ...value.labels,
                            [license]: label ?? license
                          },
                          entries: value.entries.includes(license)
                            ? value.entries.filter(name => name !== license)
                            : value.entries.length < 12
                              ? [...value.entries, license]
                              : value.entries
                        }
                      : value
                  )
                )
              }
            />
          )}
        </section>
      ))}
      {error && (
        <p role="alert" className="text-danger-ink">
          {t(gameErrorKey(error, "profileUi.profileUnavailable"))}
        </p>
      )}
      <Button disabled={busy} type="submit">
        {busy ? t("collectionUi.saving") : t("profileUi.saveMyBoard")}
      </Button>
    </form>
  );
}
