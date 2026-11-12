import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHmac } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright-core";

// Local fixture server only. The real Next page and CSS render without
// accessing a live Supabase instance or any real account.
const [admin, member, cluster, receipt, appeal] = [1, 2, 3, 4, 5].map(
  i => `ad560000-0000-4000-8000-00000000000${i}`
);
const now = new Date().toISOString();
const user = {
  id: admin,
  aud: "authenticated",
  role: "authenticated",
  email: "fixture@example.invalid",
  app_metadata: { provider: "email" },
  user_metadata: { pseudo: "FixtureAdmin" },
  created_at: now
};
const responses = {
  is_current_user_admin: true,
  get_game_info: { user: { name: "FixtureAdmin" }, karasBalance: 42 },
  admin_list_anticheat_cases: { cases: [], summary: {} },
  admin_list_anticheat_events: { events: [] },
  admin_list_anticheat_quarantines: {
    items: [
      ["AWAITING_REVIEW", ["SHARED_NETWORK_BROWSER_ONE_WAY_TRANSFER"]],
      ["AWAITING_REVIEW", []],
      ["CANCELLED", ["SHARED_NETWORK_AND_BROWSER_TRADE_SANCTION"]]
    ].map(([status, reasonCodes], i) => ({
      id: `ad560000-0000-4000-8000-00000000001${i}`,
      subjectType: "trade",
      subjectId: receipt,
      status,
      sender: { id: admin, pseudo: "FixtureAdmin" },
      recipient: { id: member, pseudo: "FixtureMember" },
      confidence: "CORROBORATED",
      economicSeverity: "MEDIUM",
      reasonCodes,
      createdAt: now,
      expiresAt: now
    })),
    awaitingReview: 2
  },
  admin_list_anticheat_connections: {},
  admin_anticheat_workload: {
    clusters: 1,
    activeQuarantines: 2,
    investigated: 1,
    confirmed: 1,
    pendingAppeals: 1
  },
  admin_list_anticheat_clusters: [
    {
      id: cluster,
      accountCount: 4,
      recentAccountCount: 3,
      activeAccountCount: 4,
      referralCount: 3,
      internalTrades: 6,
      cards: 6,
      karas: 777,
      beneficiary: "FixtureAdmin",
      priority: "CRITICAL",
      state: "REVIEWED_SIGNALS",
      farmDecision: "ECONOMICALLY_CONFIRMED",
      farmConfidence: "CORROBORATED",
      farmRisk: 75,
      farmReview: "CONFIRMED",
      farmVersion: "a".repeat(32),
      enforcement: { decision: "CORROBORATED", secondaries: [member] },
      members: [
        { id: admin, pseudo: "FixtureAdmin", createdAt: now },
        {
          id: member,
          pseudo: "A very long fixture account name for wrapping",
          createdAt: now
        }
      ],
      farmEvidence: {
        indirectCards: 2,
        cycleCards: 1,
        auctionSales: 1,
        scenarioFindings: {
          B: {
            score: 75,
            confidence: "CORROBORATED",
            decision: "ECONOMICALLY_CONFIRMED",
            cards: 6,
            secondaries: [member]
          }
        }
      }
    }
  ],
  admin_preview_anticheat_farm_recovery: {
    beneficiary: admin,
    secondaries: [member],
    unusedPacks: 5,
    attributedCards: 6,
    availableCards: 5,
    protectedCards: 1,
    blockedCards: 0,
    creditedKaras: 777,
    possibleKaras: 300,
    sales: [{ id: receipt, sale_karas: 777 }],
    recoveryEnabled: true,
    referredLots: [{ id: receipt, owner: member, packs: 3 }],
    pendingRewards: [{ id: cluster, recipient: member, packs: 2 }]
  },
  admin_preview_anticheat_asset_recovery: {
    eligible: true,
    enabled: true,
    protectedHolder: true,
    reserved: false,
    token: "b".repeat(32),
    credited: 777,
    recoverable: 300,
    unrecoverable: 477
  },
  admin_list_anticheat_appeals: [
    {
      id: appeal,
      userId: member,
      receiptId: receipt,
      receiptKind: "ACCOUNT",
      reason: "Fixture appeal concerning the ownership of one card.",
      outcome: null,
      decisionReason: null
    },
    {
      id: cluster,
      userId: member,
      receiptId: cluster,
      receiptKind: "ACCOUNT",
      reason: "Fixture appeal concerning a warning.",
      outcome: "CORRECTION_REQUIRED",
      decisionReason: "Recheck the warning.",
      canVoidWarning: true
    }
  ]
};
const fixture = createServer((req, res) => {
  req.resume();
  const path = new URL(req.url, "http://127.0.0.1").pathname;
  const payload =
    path === "/auth/v1/user" ? user : (responses[path.split("/").at(-1)] ?? []);
  res.writeHead(200, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*"
  });
  res.end(JSON.stringify(payload));
});
await new Promise(resolve => fixture.listen(0, "127.0.0.1", resolve));
const fixtureOrigin = `http://127.0.0.1:${fixture.address().port}`;
const origin = "http://127.0.0.1:3058";
const next = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "dev",
    "--webpack",
    "--hostname",
    "127.0.0.1",
    "--port",
    "3058"
  ],
  {
    env: {
      ...process.env,
      NEXT_PUBLIC_SUPABASE_URL: fixtureOrigin,
      SUPABASE_SERVER_URL: fixtureOrigin,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "local-visual-fixture",
      NEXT_PUBLIC_I18N_ENABLED: "true",
      NEXT_PUBLIC_SITE_URL: origin,
      NEXT_TELEMETRY_DISABLED: "1"
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  }
);
let log = "";
next.stdout.on("data", chunk => (log += chunk));
next.stderr.on("data", chunk => (log += chunk));
let browser;
try {
  for (let i = 0; !/Ready in|Ready in \d/.test(log) && i < 180; i++) {
    if (next.exitCode !== null) throw new Error(log);
    await delay(250);
  }
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const encode = value =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const body = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: admin, exp, aud: "authenticated", role: "authenticated", app_metadata: user.app_metadata, user_metadata: user.user_metadata })}`;
  const access_token = `${body}.${createHmac("sha256", "local-fixture-only").update(body).digest("base64url")}`;
  const session = `base64-${encode({ access_token, refresh_token: "local-fixture-only", expires_at: exp, expires_in: 3600, token_type: "bearer", user })}`;
  browser = await chromium.launch({
    executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
    headless: true
  });
  const output = await mkdtemp(join(tmpdir(), "yokkai-phase3-browser-"));
  for (const [width, zoom] of [
    [320, 1],
    [375, 1],
    [768, 1],
    [1024, 1],
    [1440, 1],
    [1024, 2],
    [1440, 2]
  ]) {
    const page = await browser.newPage({
      viewport: {
        width: Math.round(width / zoom),
        height: Math.round(950 / zoom)
      },
      deviceScaleFactor: zoom
    });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript(
      id =>
        localStorage.setItem(`yokkai-referral-reminder-dismissed:${id}`, "1"),
      admin
    );
    await page.context().addCookies([
      { name: "sb-127-auth-token", value: session, url: origin },
      { name: "yokkai_locale", value: "v1:manual:fr:seen", url: origin }
    ]);
    await page.goto(`${origin}/admin/security?cluster=${cluster}`, {
      waitUntil: "domcontentloaded",
      timeout: 90000
    });
    const groups = page.locator("#anticheat-clusters");
    const appeals = page.locator("#anticheat-appeals");
    await groups.waitFor({ timeout: 40000 });
    await appeals.waitFor();
    const counters = groups.locator(":scope > dl > div");
    assert.deepEqual(await counters.locator("dt").allTextContents(), [
      "Groupes réseau",
      "Quarantaines actives"
    ]);
    const reviews = page
      .locator("#anticheat-quarantines")
      .locator("details")
      .filter({ hasText: "Examiner l’échange" });
    assert.equal(await reviews.count(), 2);
    assert.ok(
      await page
        .locator("#anticheat-quarantines")
        .getByText("Annulation automatique · même IP et même navigateur", {
          exact: true
        })
        .isVisible()
    );
    for (const [index, status] of ["Oui", "Non renseigné"].entries()) {
      const review = reviews.nth(index);
      await review.locator("summary").click();
      assert.deepEqual(await review.locator("dt").allTextContents(), [
        "Même adresse IP",
        "Même navigateur"
      ]);
      assert.deepEqual(await review.locator("dd").allTextContents(), [
        status,
        status
      ]);
    }
    await groups
      .getByText("Examiner les actifs traçables", { exact: true })
      .click();
    assert.ok(
      await groups
        .getByText(/777 Karas crédités/)
        .first()
        .isVisible()
    );
    assert.ok(
      await appeals.locator('button[value="CORRECTION_REQUIRED"]').isVisible()
    );
    assert.ok(
      await appeals.locator('button[value="VOID_WARNING"]').isVisible()
    );
    assert.ok(
      await groups
        .getByRole("button", { name: /Récupérer 3 packs/ })
        .isVisible()
    );
    assert.ok(
      await groups
        .getByRole("button", { name: "Simuler les sanctions" })
        .isVisible()
    );
    assert.ok(
      await groups
        .getByRole("button", {
          name: "Annuler la récompense de parrainage en attente"
        })
        .isVisible()
    );
    await appeals
      .locator("summary")
      .filter({ hasText: "Générer un code d’accès au recours" })
      .click();
    assert.ok(
      await appeals.getByLabel("Identifiant du reçu de sanction").isVisible()
    );
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1
      ),
      false,
      `Horizontal overflow at ${width} / ${zoom}`
    );
    assert.deepEqual(errors, []);
    if ((width === 375 || width === 1440) && zoom === 1) {
      const screenshotStyle =
        "nextjs-portal { visibility: hidden !important; }";
      await groups.screenshot({
        path: join(output, `groups-${width}.png`),
        style: screenshotStyle
      });
      await appeals.screenshot({
        path: join(output, `appeals-${width}.png`),
        style: screenshotStyle
      });
    }
    await groups.getByRole("link", { name: /Vente .*777 Karas/ }).click();
    const recovery = page.locator("#farm-asset-preview");
    await recovery.waitFor();
    assert.ok(
      await recovery
        .getByText(/300 récupérables · 477 indisponibles/)
        .isVisible()
    );
    assert.ok(
      await recovery
        .getByRole("button", { name: "Confirmer la récupération" })
        .isVisible()
    );
    await page.context().clearCookies();
    await page
      .context()
      .addCookies([
        { name: "yokkai_locale", value: "v1:manual:fr:seen", url: origin }
      ]);
    await page.goto(`${origin}/appeal`);
    assert.ok(
      await page
        .getByRole("heading", { name: "Accéder à ton recours" })
        .isVisible()
    );
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1
      ),
      false
    );
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log(`Seven admin browser layouts passed. Screenshots: ${output}`);
} catch (error) {
  console.error(log.slice(-6000));
  throw error;
} finally {
  await browser?.close();
  next.kill();
  fixture.closeAllConnections();
  fixture.close();
}
