import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  englishMessages,
  intl,
  gameMessages,
  loadLocaleModule
} from "./helpers/i18n.mjs";
import vm from "node:vm";
import { createRequire } from "node:module";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const require = createRequire(import.meta.url);
function load(path, dependencies, globals = {}) {
  const loaded = { exports: {} };
  vm.runInNewContext(
    ts.transpileModule(
      readFileSync(new URL("../" + path, import.meta.url), "utf8"),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
          jsx: ts.JsxEmit.ReactJSX,
          esModuleInterop: true
        }
      }
    ).outputText,
    {
      exports: loaded.exports,
      module: loaded,
      URL,
      Date,
      Intl,
      ...globals,
      require: name => {
        if (name === "server-only") return {};
        if (name === "next-intl") return intl;
        if (name === "@/i18n/game-messages") return gameMessages;
        if (name === "@/i18n/locale") return loadLocaleModule();
        if (name === "react/jsx-runtime") return require(name);
        if (name === "@/lib/billing/status-sync" && !(name in dependencies))
          return { watchBillingStatus: () => () => {} };
        if (name === "next/link" && !(name in dependencies))
          return {
            __esModule: true,
            default: props => React.createElement("a", props)
          };
        assert.ok(name in dependencies, name);
        return dependencies[name];
      }
    }
  );
  return loaded.exports;
}
const state = {
  active: true,
  status: "active",
  endsAt: 2000000000,
  cancelAtPeriodEnd: false,
  hasCustomer: true
};
const billing = {
  enabled: true,
  checkoutEnabled: true,
  sandbox: true,
  status: state,
  unavailable: false
};
const Button = ({ variant: _variant, ...props }) =>
  React.createElement("button", props);

test("settings expose only safe billing presentation, keep purchases closed and preserve verification failures", async () => {
  class BillingError extends Error {
    constructor(code) {
      super(code);
      this.code = code;
    }
  }
  let config,
    failure,
    calls = 0,
    quotaCalls = 0;
  const { getBillingSettings } = load("lib/billing/settings.ts", {
    "./config": {
      BillingError,
      billingConfig: () => {
        if (failure) throw failure;
        return config;
      }
    },
    "./rate-limit": {
      consumeBillingRequest: async (id, action) => {
        assert.equal(id, "current-user");
        assert.equal(action, "status");
        quotaCalls++;
      }
    },
    "./checkout-service": {
      configuredBillingService: () => ({
        status: async id => {
          calls++;
          assert.equal(quotaCalls, calls);
          assert.equal(id, "current-user");
          return state;
        }
      })
    }
  });
  failure = new BillingError("BILLING_DISABLED");
  const disabled = await getBillingSettings("current-user");
  assert.equal(disabled.enabled, false);
  assert.equal(disabled.checkoutEnabled, false);
  assert.equal(disabled.unavailable, false);
  assert.equal(calls, 0);
  assert.equal(quotaCalls, 0);
  failure = new Error("private provider diagnostic");
  const unavailable = await getBillingSettings("current-user");
  assert.equal(unavailable.status, null);
  assert.equal(unavailable.unavailable, true);
  assert.doesNotMatch(
    JSON.stringify(unavailable),
    /private|provider diagnostic/
  );
  failure = null;
  config = {
    live: false,
    checkoutEnabled: false,
    secret: "never-serialize-me"
  };
  const result = await getBillingSettings("current-user");
  assert.equal(result.enabled, true);
  assert.equal(result.checkoutEnabled, false);
  assert.equal(result.status.active, true);
  assert.equal(result.sandbox, true);
  assert.equal(quotaCalls, 1);
  assert.doesNotMatch(JSON.stringify(result), /never-serialize/);
});

test("subscription settings render verified, canceled, unavailable and disabled states without granting optimistic Pro", () => {
  const { SubscriptionSettings } = load(
    "components/subscription-settings.tsx",
    { react: React, "@/components/ui": { Button } }
  );
  const html = value =>
    renderToStaticMarkup(
      React.createElement(SubscriptionSettings, { billing: value })
    );
  const active = html(billing);
  assert.match(active, /Pro active/);
  assert.match(active, /Next renewal/);
  assert.match(active, /Manage subscription/);
  assert.doesNotMatch(active, /Get Yokkai Pro/);
  assert.match(active, /border-success\/30 bg-success\/10 text-success/);
  assert.match(active, /Test mode/);
  assert.doesNotMatch(
    active,
    /No free trial|This tests billing only|game perks are unchanged/
  );
  const live = html({ ...billing, sandbox: false });
  assert.doesNotMatch(live, /Test mode|No free trial/);
  const canceled = html({
    ...billing,
    status: { ...state, cancelAtPeriodEnd: true }
  });
  assert.match(canceled, /Access until/);
  assert.match(canceled, /will not renew/);
  assert.match(canceled, /Pro access continues/);
  const disabled = html({
    ...billing,
    enabled: false,
    checkoutEnabled: false,
    status: null
  });
  assert.match(disabled, /No payment can be started/);
  assert.match(disabled, /disabled=""[^>]*>Get Yokkai Pro/);
  assert.doesNotMatch(disabled, /Pro active/);
  assert.doesNotMatch(disabled, /bg-success\/10 text-success/);
  const unavailable = html({ ...billing, status: null, unavailable: true });
  assert.match(unavailable, /Status unavailable/);
  assert.match(unavailable, /Unable to verify/);
  assert.doesNotMatch(unavailable, />Basic</);
});

test("subscription actions post empty server-owned input, block duplicates and reject untrusted redirects", async () => {
  let index = 0,
    fetches = 0,
    resolveResponse;
  const slots = [];
  const redirects = [];
  const react = {
    ...React,
    useSyncExternalStore: (_subscribe, _client, server) => server(),
    useEffect: () => {},
    useState: initial => {
      const slot = index++;
      if (!(slot in slots)) slots[slot] = initial;
      return [
        slots[slot],
        next => {
          slots[slot] = next;
        }
      ];
    },
    useRef: initial => {
      const slot = index++;
      return (slots[slot] ??= { current: initial });
    }
  };
  const { SubscriptionSettings } = load(
    "components/subscription-settings.tsx",
    { react, "@/components/ui": { Button } },
    {
      window: { location: { assign: url => redirects.push(url) } },
      fetch: async (url, options) => {
        fetches++;
        assert.equal(url, "/api/billing/portal");
        assert.equal(options.method, "POST");
        assert.equal(options.body, "{}");
        return new Promise(resolve => {
          resolveResponse = resolve;
        });
      }
    }
  );
  const render = () => {
    index = 0;
    return SubscriptionSettings({ billing });
  };
  const nodes = node =>
    Array.isArray(node)
      ? node.flatMap(nodes)
      : React.isValidElement(node)
        ? [node, ...nodes(node.props.children)]
        : [];
  const tree = render();
  const manage = nodes(tree).find(
    n => n.props.children === "Manage subscription"
  );
  manage.props.onClick();
  manage.props.onClick();
  assert.equal(fetches, 1);
  assert.equal(
    nodes(render()).find(n => n.props.children === "Opening Stripe…").props
      .disabled,
    true
  );
  resolveResponse({
    ok: true,
    json: async () => ({
      url: "https://billing.stripe.com.evil.example/portal"
    })
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(redirects.length, 0);
  assert.ok(nodes(render()).some(n => n.props.role === "alert"));
});

// Product contract approved with Walid: the UI need not expose a manual refresh.
// Automatic polling/focus behavior is covered by additional implementation tests.
test("server-verified renewal, scheduled cancellation and ended access remain distinct", () => {
  const { SubscriptionSettings } = load(
    "components/subscription-settings.tsx",
    { react: React, "@/components/ui": { Button } }
  );
  const html = status =>
    renderToStaticMarkup(
      React.createElement(SubscriptionSettings, {
        billing: { ...billing, status }
      })
    );
  const renewing = html(state);
  assert.match(renewing, /Pro active/);
  assert.match(renewing, /Next renewal/);
  assert.doesNotMatch(renewing, /will not renew/);
  const canceled = html({ ...state, cancelAtPeriodEnd: true });
  assert.match(canceled, /Pro active/);
  assert.match(canceled, /Access until/);
  assert.match(canceled, /will not renew/);
  assert.match(canceled, /Pro access continues/);
  const ended = html({
    ...state,
    active: false,
    status: "canceled",
    endsAt: null
  });
  assert.doesNotMatch(ended, /Pro active/);
  assert.doesNotMatch(ended, /Pro access continues/);
  assert.match(ended, /Get Yokkai Pro/);
});

test("automatic synchronization updates the cancellation message without a refresh button", async () => {
  let index = 0;
  let effect,
    publish,
    stopCalled = false;
  const slots = [];
  const react = {
    ...React,
    useSyncExternalStore: (_subscribe, _client, server) => server(),
    useEffect: callback => {
      effect = callback;
    },
    useState: initial => {
      const slot = index++;
      if (!(slot in slots)) slots[slot] = initial;
      return [
        slots[slot],
        next => {
          slots[slot] = next;
        }
      ];
    },
    useRef: initial => {
      const slot = index++;
      return (slots[slot] ??= { current: initial });
    }
  };
  const { SubscriptionSettings } = load(
    "components/subscription-settings.tsx",
    {
      react,
      "@/components/ui": { Button },
      "@/lib/billing/status-sync": {
        watchBillingStatus: update => {
          publish = update;
          return () => {
            stopCalled = true;
          };
        }
      }
    }
  );
  const render = () => {
    index = 0;
    return SubscriptionSettings({ billing });
  };
  const nodes = node =>
    Array.isArray(node)
      ? node.flatMap(nodes)
      : React.isValidElement(node)
        ? [node, ...nodes(node.props.children)]
        : [];
  assert.equal(
    nodes(render()).some(n => n.props.children === "Refresh status"),
    false
  );
  const stop = effect();
  publish({ ...state, cancelAtPeriodEnd: true });
  const updated = nodes(render());
  assert.ok(updated.some(n => n.props.children === "Access until"));
  assert.ok(
    updated.some(n =>
      React.Children.toArray(n.props.children)
        .join("")
        .includes("will not renew")
    )
  );
  stop();
  assert.equal(stopCalled, true);
});

test("the authenticated settings page owns management and all provider returns target its subscription section", () => {
  const page = readFileSync(
    new URL("../app/settings/page.tsx", import.meta.url),
    "utf8"
  );
  assert.ok(
    page.indexOf('if (!user) redirect("/login")') <
      page.indexOf("getBillingSettings(user.id)")
  );
  assert.match(page, /<SubscriptionSettings billing=\{billing\}/);
  const server = readFileSync(
    new URL("../lib/billing/server.ts", import.meta.url),
    "utf8"
  );
  assert.match(
    server,
    /success_url: `\$\{config.origin\}\/settings\?checkout=returned#subscription`/
  );
  assert.match(
    server,
    /cancel_url: `\$\{config.origin\}\/settings\?checkout=canceled#subscription`/
  );
  assert.match(
    server,
    /return_url: `\$\{config.origin\}\/settings#subscription`/
  );
  const topbar = readFileSync(
    new URL("../components/topbar.tsx", import.meta.url),
    "utf8"
  );
  assert.match(
    topbar,
    /href="\/settings"[\s\S]*?>\s*\{t\("settings"\)\}\s*<\/Link>/
  );
  assert.equal(englishMessages.topbar.settings, "Settings");
});
