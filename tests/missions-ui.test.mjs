import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { fixture } from "./helpers/pr5-render.mjs";
export const missionFixture = {
  serverNow: "2026-11-10T10:00:00Z",
  launchAt: "2026-11-09T19:00:00Z",
  active: true,
  pro: false,
  periods: ["daily", "weekly"].map(period => ({
    period,
    startAt: "2026-11-09T19:00:00Z",
    endsAt:
      period === "daily" ? "2026-11-10T19:00:00Z" : "2026-11-16T19:00:00Z",
    points: 65,
    missions: [
      {
        id: "packs",
        metric: "regular_packs_opened",
        target: 30,
        points: 30,
        category: "packs",
        current: 30
      },
      {
        id: "new",
        metric: "new_cards",
        target: 10,
        points: 20,
        category: "collection",
        current: 8
      },
      {
        id: "trade",
        metric: "trades_proposed",
        target: 1,
        points: 20,
        category: "social",
        current: 0
      }
    ],
    milestones: (period === "daily"
      ? [20, 50, 80, 100]
      : [20, 40, 60, 80, 100]
    ).map(points => ({
      points,
      reward: points + 5,
      claimedAt: points === 20 ? "2026-11-10T09:00:00Z" : null
    }))
  }))
};
for (const locale of ["en", "fr"])
  test(`missions and grouped achievements render accessible translated states in ${locale}`, () => {
    const f = fixture(locale, file => {
      if (file === "components/topbar.tsx")
        return "export function Topbar(){return null}";
      if (file === "lib/data/cards.ts")
        return "export const getGameInfo=async()=>({}); export const invalidatePlayerSnapshots=()=>{};";
      if (file === "lib/data/achievements.ts")
        return "export const getAchievements=async()=>[];export const claimAchievement=async()=>({});";
      if (file === "lib/data/achievement-catalogue.ts")
        return "export const claimCatalogueAchievement=async()=>({});export const claimAchievementUpgrade=async()=>({});export const getAchievementCatalogue=async()=>[];";
      if (file === "lib/data/missions.ts")
        return "export const getMissions=async()=>({});export const claimMissionMilestone=async()=>({});";
      return readFileSync(file, "utf8");
    });
    const { MissionGauges } = f.page("components/missions.tsx");
    const { AchievementsGallery } = f.page("components/achievements.tsx");
    const html = renderToStaticMarkup(
      React.createElement(MissionGauges, {
        data: missionFixture,
        onClaim() {},
        onRefresh() {}
      })
    );
    assert.equal((html.match(/<progress/g) || []).length, 2);
    assert.match(html, /aria-label=/);
    assert.doesNotMatch(html, /missionUi\.|MISSING_MESSAGE|INVALID_MESSAGE/);
    assert.match(
      html,
      locale === "en" ? /Daily missions/ : /Missions quotidiennes/
    );
    const base = {
      title: "Pack Opener",
      description: "",
      conditionType: "regular_packs_opened",
      conditionCategory: null,
      progressCurrent: 10,
      progressTarget: 10,
      progressLabel: null,
      completedAt: "2026-11-10T10:00:00Z",
      claimedAt: null,
      family: "pack-opener",
      section: "packs",
      karasReward: 25
    };
    const gallery = renderToStaticMarkup(
      React.createElement(AchievementsGallery, {
        items: [
          { ...base, id: "one", conditionValue: 1 },
          { ...base, id: "ten", conditionValue: 10 }
        ],
        onClaim() {}
      })
    );
    // Tiers are browsed in place: both stay rendered, one shown at a time.
    assert.equal((gallery.match(/yk-achievement-tiers/g) || []).length, 1);
    assert.equal((gallery.match(/<article[^>]*hidden/g) || []).length, 1);
    assert.equal((gallery.match(/<article/g) || []).length, 2);
    assert.doesNotMatch(gallery, /achievementCatalog\.|MISSING_MESSAGE/);
  });
