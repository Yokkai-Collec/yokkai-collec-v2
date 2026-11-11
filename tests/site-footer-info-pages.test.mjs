import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { englishMessages } from "./helpers/i18n.mjs";
import { homePresentation } from "./helpers/home-presentation.mjs";

const read = path => readFileSync(path, "utf8");

test("the site footer links the public guide pages and Discord accessibly", () => {
  const footer = read("components/site-footer.tsx");

  for (const route of ["/rarities", "/rules", "/info"]) {
    assert.match(footer, new RegExp(`href=["']${route}["']`));
  }
  assert.match(footer, /href="\/discord"/);
  assert.match(footer, /aria-label=\{t\("joinTheYokkaiDiscord"\)\}/);
  assert.equal(
    englishMessages.siteFooter.joinTheYokkaiDiscord,
    "Join the Yokkai Discord"
  );
  assert.match(footer, /target="_blank"/);
  assert.match(footer, /rel="noopener noreferrer"/);
});

test("public guide pages have English metadata and useful content", () => {
  const rarities = read("app/rarities/page.tsx");
  const rules = read("app/rules/page.tsx");
  const info = read("app/info/page.tsx");

  for (const rarity of ["C", "R", "SR", "SSR", "LR"]) {
    assert.match(rarities, new RegExp(`["']${rarity}["']`));
  }
  for (const rate of ["69.4%", "20%", "10%", "0.5%", "0.1%"])
    assert.match(rarities, new RegExp(rate.replace(".", "\\.")));
  assert.match(rarities, /LR SHINY/);
  assert.match(rarities, /0\.001%/);
  assert.match(
    rarities,
    /t(?:\.rich)?\("theFirstFivePercentagesAreTheCurrent"/
  );
  assert.match(
    englishMessages.legalUi.theFirstFivePercentagesAreTheCurrent,
    /1 in 100,000 pull per card/
  );
  assert.match(
    rarities,
    /t(?:\.rich)?\("theFirstFivePercentagesAreTheCurrent"/
  );
  assert.match(
    englishMessages.legalUi.theFirstFivePercentagesAreTheCurrent,
    /independent 1% chance/
  );
  assert.match(
    rarities,
    /t(?:\.rich)?\("decisionPacksOnlyContainHighRarityChoices"/
  );
  assert.match(
    englishMessages.legalUi.decisionPacksOnlyContainHighRarityChoices,
    /0\.005% chance per revealed card \(1 in 20,000\)/
  );
  assert.match(rules, /t(?:\.rich)?\("doNotAutomatePackOpeningsOrOther"/);
  assert.match(
    englishMessages.legalUi.doNotAutomatePackOpeningsOrOther,
    /Do not automate pack openings/
  );
  assert.match(rules, /t(?:\.rich)?\("doNotCreateAccountsToFarmReferrals"/);
  assert.match(
    englishMessages.legalUi.doNotCreateAccountsToFarmReferrals,
    /Do not create accounts to farm referrals/
  );
  assert.match(info, /t(?:\.rich)?\("anUnofficialFanProject"/);
  assert.match(
    englishMessages.legalUi.anUnofficialFanProject,
    /unofficial fan project/i
  );
  assert.match(info, /t(?:\.rich)?\("yokkaiCollecIsNotAffiliatedWithOr"/);
  assert.match(
    englishMessages.legalUi.yokkaiCollecIsNotAffiliatedWithOr,
    /respective rights holders/
  );
});

test("the LR Shiny guide entry is distinctive and stays readable on mobile", () => {
  const rarities = read("app/rarities/page.tsx");
  const styles = read("styles/info-pages.css");

  assert.match(rarities, /data-rarity="LR-SHINY"/);
  assert.match(rarities, /t(?:\.rich)?\("directlyPulledShinyCardsAreLRCards"/);
  assert.match(
    englishMessages.legalUi.directlyPulledShinyCardsAreLRCards,
    /Directly pulled Shiny cards are LR cards/
  );
  assert.match(styles, /\.yk-rarity-row\[data-rarity="LR-SHINY"\]/);
  assert.match(styles, /background-clip: text/);
  assert.match(
    styles,
    /@media \(max-width: 640px\)[\s\S]*grid-template-columns: minmax\(76px, auto\) minmax\(0, 1fr\)/
  );
});

test("the landing and player pack shell use the expanded footer", () => {
  const landing = homePresentation().footer;
  const game = read("components/game.tsx");

  assert.match(landing, /<FooterNavigation \/>/);
  assert.match(landing, /className="yk-site-footer-discord"/);
  assert.match(game, /<SiteFooter/);
  assert.match(game, /discordEnabled=\{discordEnabled\}/);
});

test("the shared player shells render the site footer", () => {
  const community = read("components/community-page.tsx");
  const settings = read("app/settings/page.tsx");
  const achievements = read("app/achievements/page.tsx");

  for (const source of [community, settings, achievements]) {
    assert.match(source, /<SiteFooter/);
    assert.match(source, /Boolean\(getDiscordInviteUrl\(\)\)/);
  }

  for (const route of ["market", "profile", "trades", "wishlist", "catalog"]) {
    assert.match(read(`app/${route}/page.tsx`), /<CommunityPage/);
  }
  assert.match(read("app/social/layout.tsx"), /<CommunityPage/);
  assert.match(read("app/friends/page.tsx"), /redirect\(`\/social\/friends/);
  assert.match(read("app/social/friends/page.tsx"), /<FriendsView/);
});
