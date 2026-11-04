import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright-core";
const base = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3019";
const browser = await chromium.launch({ channel: "chrome", headless: true });
mkdirSync("artifacts/profile-favorite-binders", { recursive: true });
let scenarios = 0;
async function open(options = {}) {
  const page = await browser.newPage(options);
  await page.route(
    url => !url.href.startsWith(base),
    route => route.abort()
  );
  return page;
}
async function steady(page) {
  await page.evaluate(() => {
    for (const a of document.getAnimations())
      if (a.effect?.getComputedTiming().iterations !== Infinity) a.finish();
  });
}
async function noOverflow(page) {
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1
    ),
    false
  );
}
try {
  for (const lang of ["en", "fr"]) {
    const page = await open({ viewport: { width: 1440, height: 1000 } });
    const session = await page.context().newCDPSession(page);
    const response = await page.goto(
      `${base}/design-system/profile-favorite-binders-preview?lang=${lang}`,
      { waitUntil: "domcontentloaded" }
    );
    assert.equal(response.status(), 200);
    await page.locator('[data-preview-ready="true"]').waitFor();
    assert.equal(
      await page.locator("main").getAttribute("data-request-count"),
      "0"
    );
    for (const [width, zoom] of [
      [320, 1],
      [375, 1],
      [768, 1],
      [1024, 1],
      [1440, 1],
      [1024, 2],
      [1440, 2]
    ]) {
      const effective = Math.round(width / zoom);
      await page.setViewportSize({
        width: effective,
        height: Math.round(1000 / zoom)
      });
      await session.send("Emulation.setDeviceMetricsOverride", {
        width: effective,
        height: Math.round(1000 / zoom),
        deviceScaleFactor: zoom,
        mobile: false
      });
      const baselineRequests = await page
        .locator("main")
        .getAttribute("data-request-count");
      await page.waitForFunction(
        size =>
          document.querySelectorAll(".yk-profile-favorite-binder").length ===
          size,
        effective >= 640 ? 6 : 4
      );
      await page.locator('[data-preview-ready="true"]').waitFor();
      const cards = page.locator(".yk-profile-favorite-binder");
      await page.waitForFunction(
        () =>
          document.querySelector(".yk-profile-favorite-binder img")
            ?.naturalWidth > 0
      );
      await noOverflow(page);
      assert.equal(
        await page.locator("main").getAttribute("data-request-count"),
        baselineRequests
      );
      if (lang === "fr" && zoom === 1 && (width === 375 || width === 1440))
        await page.screenshot({
          path: `artifacts/profile-favorite-binders/${width}.png`,
          fullPage: true
        });
      const pagination = page.locator(
        ".yk-profile-favorite-pages .yk-pagination"
      );
      await pagination.locator("button").nth(2).click();
      await page.waitForFunction(
        () =>
          !document
            .querySelector(".yk-profile-favorite-binder")
            ?.textContent.includes("Bleach")
      );
      assert.ok(!(await cards.first().innerText()).includes("Bleach"));
      await pagination.locator("button").nth(3).click();
      await page.waitForFunction(
        () =>
          document.querySelectorAll(".yk-profile-favorite-binder").length === 1
      );
      assert.equal(await cards.count(), 1);
      assert.ok((await cards.first().innerText()).includes("Code Geass"));
      assert.equal(
        await page.locator("main").getAttribute("data-request-count"),
        baselineRequests,
        "Favorite pagination never reads somebody else's inventory"
      );
      await pagination.locator("button").nth(0).click();
      await page.waitForFunction(() =>
        document
          .querySelector(".yk-profile-favorite-binder")
          ?.textContent.includes("Bleach")
      );
      await cards.first().click();
      const dialog = page.locator("dialog[open]");
      await dialog.waitFor();
      await page.waitForFunction(
        () =>
          document.querySelectorAll(".yk-profile-binder-cards > li").length ===
          24
      );
      await steady(page);
      await noOverflow(page);
      assert.ok((await dialog.innerText()).includes("Bleach"));
      assert.equal(
        await page
          .locator('.yk-profile-binder-cards > li[data-owned="true"]')
          .count(),
        7
      );
      assert.equal(
        await page
          .locator('.yk-profile-binder-cards > li[data-owned="false"]')
          .count(),
        17
      );
      if (lang === "fr" && zoom === 1 && (width === 375 || width === 1440))
        await page.screenshot({
          path: `artifacts/profile-favorite-binders/${width}-open.png`,
          fullPage: true
        });
      const expectedRequests =
        Number(await page.locator("main").getAttribute("data-request-count")) +
        1;
      await dialog.locator(".yk-pagination button").nth(2).click();
      await page.waitForFunction(
        expected =>
          Number(document.querySelector("main").dataset.requestCount) ===
            expected &&
          document.querySelectorAll(".yk-profile-binder-cards > li").length ===
            24,
        expectedRequests
      );
      assert.equal(
        await page
          .locator('.yk-profile-binder-cards > li[data-owned="true"]')
          .count(),
        0
      );
      await dialog.locator('input[type="checkbox"]').check();
      await page.waitForFunction(
        () =>
          document.querySelectorAll(".yk-profile-binder-cards > li").length ===
          7
      );
      assert.equal(await dialog.locator(".yk-pagination").count(), 0);
      await noOverflow(page);
      await page.keyboard.press("Escape");
      await page.waitForFunction(() => !document.querySelector("dialog[open]"));
      assert.equal(
        await cards.first().evaluate(el => el === document.activeElement),
        true,
        "Closing returns focus to the binder"
      );
      scenarios++;
    }
    await page.close();
  }
  for (const query of ["private=1", "count=0", "count=1"]) {
    const page = await open({ viewport: { width: 375, height: 900 } });
    await page.goto(
      `${base}/design-system/profile-favorite-binders-preview?${query}`,
      { waitUntil: "domcontentloaded" }
    );
    await page.locator('[data-preview-ready="true"]').waitFor();
    await noOverflow(page);
    assert.equal(
      await page.locator(".yk-profile-favorite-binder").count(),
      query === "count=1" ? 1 : 0
    );
    assert.equal(await page.locator(".yk-profile-favorite-pages").count(), 0);
    assert.equal(
      await page.locator("main").getAttribute("data-request-count"),
      "0"
    );
    await page.close();
  }
  const page = await open({ viewport: { width: 375, height: 900 } });
  await page.goto(
    `${base}/design-system/profile-favorite-binders-preview?fail=1`,
    { waitUntil: "domcontentloaded" }
  );
  await page.locator('[data-preview-ready="true"]').waitFor();
  await page.locator(".yk-profile-favorite-binder").first().click();
  await page.locator('dialog [role="alert"]').waitFor();
  await page.locator('dialog [role="alert"] button').click();
  await page.waitForFunction(
    () =>
      document.querySelectorAll(".yk-profile-binder-cards > li").length === 24
  );
  await page.close();
  console.log(
    JSON.stringify({
      responsiveScenarios: scenarios,
      pagination: "passed",
      modalAndOwnership: "passed",
      privacyEmptySingleRetry: "passed"
    })
  );
} finally {
  await browser.close();
}
