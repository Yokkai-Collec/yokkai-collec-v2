import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import React from "react";
import { intl } from "./helpers/i18n.mjs";
const require = createRequire(import.meta.url);
function fixture({
  permission = "default",
  seen = false,
  storageFails = false,
  permissionResult = "granted",
  saveError = false,
  ios = false,
  supported = true,
  modal = false
} = {}) {
  const states = [],
    effects = [],
    timers = [],
    writes = [],
    calls = [];
  let index = 0;
  const storage = new Map(
    seen ? [["yokkai-push-invitation-seen:viewer", "1"]] : []
  );
  const subscription = {
    endpoint: "https://fcm.googleapis.com/send/test",
    toJSON: () => ({ keys: { p256dh: "key", auth: "auth" } }),
    unsubscribe: async () => true
  };
  const registration = {
    pushManager: {
      getSubscription: async () => null,
      subscribe: async () => {
        calls.push("subscribe");
        return subscription;
      }
    }
  };
  const exports = {};
  const Notification = {
    permission,
    requestPermission: async () => {
      calls.push("permission");
      return permissionResult;
    }
  };
  vm.runInNewContext(
    ts.transpileModule(readFileSync("components/push-settings.tsx", "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX
      }
    }).outputText,
    {
      exports,
      process: { env: { NEXT_PUBLIC_VAPID_PUBLIC_KEY: "YWJj" } },
      atob,
      Uint8Array,
      Notification,
      window: {
        isSecureContext: supported,
        PushManager: {},
        Notification,
        matchMedia: () => ({ matches: false })
      },
      navigator: {
        userAgent: ios ? "iPhone" : "Chrome",
        platform: "Win32",
        maxTouchPoints: 0,
        serviceWorker: {
          register: async () => registration,
          ready: Promise.resolve(registration)
        }
      },
      document: {
        visibilityState: "visible",
        querySelector: () => (modal ? {} : null)
      },
      localStorage: {
        getItem: key => {
          if (storageFails) throw Error("blocked");
          return storage.get(key);
        },
        setItem: (key, value) => {
          if (storageFails) throw Error("blocked");
          storage.set(key, value);
          writes.push(key);
        }
      },
      setTimeout: fn => {
        timers.push(fn);
        return timers.length;
      },
      clearTimeout: () => {},
      require: name =>
        name === "react"
          ? {
              ...React,
              useState: initial => {
                const i = index++;
                if (!(i in states)) states[i] = initial;
                return [
                  states[i],
                  value => {
                    states[i] = value;
                  }
                ];
              },
              useEffect: fn => effects.push(fn)
            }
          : name === "next-intl"
            ? intl
            : name === "next/navigation"
              ? { usePathname: () => "/" }
              : name === "@/utils/supabase/client"
                ? {
                    createClient: () => ({
                      from: () => ({
                        upsert: async data => {
                          calls.push("save");
                          assert.equal(data.user_id, "viewer");
                          return {
                            error: saveError ? Error("save failed") : null
                          };
                        }
                      })
                    })
                  }
                : name === "@/lib/data/push-subscriptions"
                  ? { disablePushSubscription: async () => {} }
                  : require(name)
    }
  );
  const render = () => {
    index = 0;
    return exports.PushSettings({ userId: "viewer", invitation: true });
  };
  const settle = () => new Promise(resolve => setImmediate(resolve));
  return { render, effects, timers, calls, writes, settle };
}
function button(node, text) {
  if (!node || typeof node !== "object") return null;
  if (node.type === "button" && node.props.children === text) return node;
  for (const child of React.Children.toArray(node.props?.children)) {
    const found = button(child, text);
    if (found) return found;
  }
  return null;
}
test("push invitation appears once without requesting permission and enables from the click", async () => {
  const f = fixture();
  assert.equal(f.render(), null);
  for (const effect of f.effects.splice(0)) effect();
  await f.settle();
  for (const timer of f.timers.splice(0)) timer();
  await f.settle();
  const view = f.render();
  assert.ok(view);
  assert.equal(f.writes.length, 1);
  assert.deepEqual(f.calls, []);
  await button(view, "Enable notifications").props.onClick();
  await f.settle();
  assert.deepEqual(f.calls, ["permission", "subscribe", "save"]);
  assert.equal(f.render(), null);
});
test("seen, decided permissions and unavailable storage never show the invitation", async () => {
  for (const options of [
    { seen: true },
    { permission: "denied" },
    { permission: "granted" },
    { storageFails: true },
    { ios: true },
    { supported: false },
    { modal: true }
  ]) {
    const f = fixture(options);
    f.render();
    for (const effect of f.effects.splice(0)) effect();
    await f.settle();
    for (const timer of f.timers.splice(0)) timer();
    await f.settle();
    assert.equal(f.render(), null);
    assert.deepEqual(f.calls, []);
  }
});

test("dismissal, native refusal and subscription failures leave settings available", async () => {
  for (const options of [
    {},
    { permissionResult: "denied" },
    { permissionResult: "default" },
    { saveError: true }
  ]) {
    const f = fixture(options);
    f.render();
    for (const effect of f.effects.splice(0)) effect();
    await f.settle();
    for (const timer of f.timers.splice(0)) timer();
    const view = f.render();
    if (Object.keys(options).length) {
      await button(view, "Enable notifications").props.onClick();
      await f.settle();
      assert.ok(f.render());
    }
    button(f.render(), "No thanks").props.onClick();
    assert.equal(f.render(), null);
    assert.equal(f.writes.length, 1);
  }
});
