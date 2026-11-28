import { intl } from "./helpers/i18n.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);

for (const view of ["leaderboard", "events"])
  test(`${view} loads zero and nonzero balances, refreshes changes and recovers from failures`, async () => {
    const states = [];
    const requests = [];
    let index = 0;
    let effect;
    let listener;
    let unsubscribed = false;
    const exports = {};
    const source = ts.transpileModule(
      readFileSync("components/leaderboard-topbar.tsx", "utf8"),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
          jsx: ts.JsxEmit.ReactJSX
        }
      }
    ).outputText;
    vm.runInNewContext(source, {
      exports,
      require: name => {
        if (name === "next-intl") return intl;
        if (name === "react")
          return {
            useState(initial) {
              const slot = index++;
              if (!(slot in states)) states[slot] = initial;
              return [
                states[slot],
                value => {
                  states[slot] =
                    typeof value === "function" ? value(states[slot]) : value;
                }
              ];
            },
            useEffect(callback) {
              effect = callback;
            }
          };
        if (name === "@/components/topbar") return { Topbar: "topbar" };
        if (name === "@/lib/data/cards")
          return {
            getGameInfo: () =>
              new Promise((resolve, reject) =>
                requests.push({ resolve, reject })
              )
          };
        if (name === "@/lib/data/player-state")
          return {
            subscribePlayerSnapshotInvalidation: callback => {
              listener = callback;
              return () => {
                unsubscribed = true;
              };
            }
          };
        return require(name);
      }
    });
    const render = () => {
      index = 0;
      return exports.LeaderboardTopbar({
        account: "account menu",
        ...(view === "events" ? { view } : {})
      }).props;
    };
    assert.equal(render().karas, undefined);
    let cleanup = effect();
    requests.shift().resolve({ karasBalance: 0 });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(render().karas, 0);
    listener(["profile"]);
    assert.equal(requests.length, 0);
    listener(["balance"]);
    requests.shift().resolve({ karasBalance: 7514 });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(render().karas, 7514);
    listener(["balance"]);
    requests.shift().reject(new Error("offline"));
    await new Promise(resolve => setImmediate(resolve));
    assert.match(render().infoError, /Couldn't load your balance/);
    render().onRetryInfo();
    cleanup();
    render();
    cleanup = effect();
    requests.shift().resolve({ karasBalance: 8000 });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(render().infoError, undefined);
    assert.equal(render().karas, 8000);
    assert.equal(render().view, view);
    assert.equal(render().account, "account menu");
    listener(["balance"]);
    cleanup();
    requests.shift().resolve({ karasBalance: 9999 });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(render().karas, 8000);
    assert.equal(unsubscribed, true);
  });

test("Referral Event mounts the balance-loading navigation instead of an unfed Topbar", async () => {
  const exports = {};
  const imports = {
    "next-intl/server": { getTranslations: async () => key => key },
    "next/headers": { cookies: async () => ({}) },
    "next/navigation": {
      redirect: () => {
        throw Error("Unexpected redirect");
      }
    },
    "@/lib/auth/session": { getCurrentUser: async () => ({ id: "player" }) },
    "@/lib/referrals/server": { getReferralStatus: async () => ({}) },
    "@/utils/supabase/server": {
      createClient: () => ({ rpc: async () => ({ data: null, error: null }) })
    },
    "@/components/topbar": { Topbar: "unfed-topbar" },
    "@/components/leaderboard-topbar": {
      LeaderboardTopbar: "balance-loading-topbar"
    },
    "@/components/account-menu": { AccountMenu: "account-menu" },
    "@/components/referral-panel": { ReferralPanel: "referral-panel" },
    "@/components/referral-event": { ReferralEventPanel: "event-panel" },
    "@/components/invocation-card-back": {
      InvocationCardBackProvider: "invocation-card-back"
    },
    "@/lib/data/invocation-card-back": {
      getInvocationCardBack: async () => null
    }
  };
  vm.runInNewContext(
    ts.transpileModule(readFileSync("app/referral-event/page.tsx", "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX
      }
    }).outputText,
    {
      exports,
      URL,
      process: { env: {} },
      require: name => imports[name] ?? require(name)
    }
  );
  const page = await exports.default();
  const header = page.props.children[0];
  assert.equal(header.type, "balance-loading-topbar");
  assert.equal(header.props.view, "events");
  assert.equal(header.props.account.type, "account-menu");
});
