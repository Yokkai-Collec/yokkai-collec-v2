import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { configureProEntitlements } from "../scripts/configure-pro-entitlements.mjs";

const require = createRequire(import.meta.url),
  root = resolve(import.meta.dirname, "..");
function setup({
  active = false,
  user = { id: "6c000000-0000-4000-8000-000000000001" },
  rpcError = null,
  deletedDuringUpload = false,
  stale = null,
  reserveError = null
} = {}) {
  const calls = [],
    cache = new Map();
  const db = {
    async rpc(name, args) {
      calls.push({ name, args });
      if (name === "claim_stale_profile_media")
        return { data: stale, error: null };
      return { data: active, error: rpcError };
    },
    from(table) {
      return {
        select() {
          return {
            eq(column, value) {
              calls.push({ read: table, column, value });
              return {
                maybeSingle: async () => ({
                  data: deletedDuringUpload ? { user_id: value } : null,
                  error: null
                })
              };
            }
          };
        },
        delete() {
          return {
            eq(column, value) {
              return {
                in: async (nextColumn, values) => {
                  calls.push({
                    deleted: table,
                    column,
                    value,
                    nextColumn,
                    values
                  });
                  return { error: null };
                },
                eq: async (nextColumn, nextValue) => {
                  calls.push({
                    deleted: table,
                    column,
                    value,
                    nextColumn,
                    nextValue
                  });
                  return { error: null };
                }
              };
            }
          };
        },
        async insert(value) {
          calls.push({ table, value });
          return { error: reserveError && { message: reserveError } };
        },
        async upsert(value) {
          calls.push({ table, value });
          return { error: null };
        }
      };
    },
    storage: {
      from() {
        return {
          getPublicUrl: path => ({
            data: {
              publicUrl: `http://localhost:54321/storage/v1/object/public/avatars/${path}`
            }
          }),
          async upload(path, bytes, options) {
            calls.push({ path, bytes, options });
            return { error: null };
          },
          async remove(paths) {
            calls.push({ removed: paths });
            return { error: null };
          }
        };
      }
    }
  };
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    const compiled = { exports: {} };
    cache.set(file, compiled.exports);
    vm.runInNewContext(
      ts.transpileModule(readFileSync(resolve(root, file), "utf8"), {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022
        }
      }).outputText,
      {
        module: compiled,
        exports: compiled.exports,
        Buffer,
        Error,
        URL,
        Response,
        Request,
        File,
        FormData,
        process: {
          env: {
            NODE_ENV: "development",
            NEXT_PUBLIC_SITE_URL: "http://localhost:3000",
            SUPABASE_SECRET_KEY: "fixture-only"
          }
        },
        require(id) {
          if (id === "server-only") return {};
          if (id === "@supabase/supabase-js") return { createClient: () => db };
          if (id === "@/utils/supabase/config")
            return {
              getSupabaseConfig: () => ({ url: "http://localhost:54321" })
            };
          if (id === "@/lib/auth/session")
            return { getCurrentUser: async () => user };
          if (id.startsWith("@/")) return load(id.slice(2) + ".ts");
          return require(id);
        }
      }
    );
    return compiled.exports;
  }
  return { load, calls };
}
const jsonRequest = value =>
  new Request("http://localhost:3000/api/pro/profile-style", {
    method: "POST",
    headers: {
      origin: "http://localhost:3000",
      "Content-Type": "application/json"
    },
    body: JSON.stringify(value)
  });
const imageRequest = (
  purpose = "avatar",
  name = "disguised.jpg",
  mime = "image/jpeg",
  extra = false
) => {
  const form = new FormData();
  form.set("purpose", purpose);
  const bytes = Buffer.from(
    "R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==",
    "base64"
  );
  form.set("file", new File([bytes], name, { type: mime }));
  if (extra) form.set("userId", "someone-else");
  return new Request("http://localhost:3000/api/profile-media", {
    method: "POST",
    headers: { origin: "http://localhost:3000" },
    body: form
  });
};
test("Pro API authenticates self, rejects CSRF and never trusts forged paid/user flags", async () => {
  const anonymous = setup({ user: null });
  assert.equal(
    (
      await anonymous
        .load("app/api/pro/benefits/route.ts")
        .GET(new Request("http://localhost:3000/api/pro/benefits"))
    ).status,
    401
  );
  assert.equal(anonymous.calls.length, 0);
  const basic = setup(),
    route = basic.load("app/api/pro/profile-style/route.ts");
  assert.equal(
    (
      await route.POST(
        new Request("http://localhost:3000/api/pro/profile-style", {
          method: "POST",
          headers: { origin: "https://evil.test" },
          body: "{}"
        })
      )
    ).status,
    403
  );
  assert.equal(
    (await route.POST(jsonRequest({ style: { effect: "neon" }, isPro: true })))
      .status,
    400
  );
  assert.equal(
    (await route.POST(jsonRequest({ style: { effect: "neon" } }))).status,
    403
  );
  assert.ok(basic.calls.every(call => call.table !== "profile_customizations"));
  const paid = setup({ active: true }),
    response = await paid
      .load("app/api/pro/profile-style/route.ts")
      .POST(jsonRequest({ style: { effect: "neon" } }));
  assert.equal(response.status, 200);
  assert.equal(
    paid.calls.find(call => call.table === "profile_customizations").value
      .user_id,
    "6c000000-0000-4000-8000-000000000001"
  );
  const failed = setup({ rpcError: { message: "private provider secret" } });
  const unavailable = await failed
    .load("app/api/pro/benefits/route.ts")
    .GET(new Request("http://localhost:3000/api/pro/benefits"));
  assert.equal(unavailable.status, 503);
  assert.doesNotMatch(await unavailable.text(), /private provider secret/);
});
test("image upload checks actual GIF bytes despite forged JPEG filename/MIME and derives immutable ownership", async () => {
  const basic = setup(),
    route = basic.load("app/api/profile-media/route.ts");
  assert.equal((await route.POST(imageRequest())).status, 403);
  assert.equal((await route.POST(imageRequest("banner"))).status, 403);
  assert.equal(
    (await route.POST(imageRequest("avatar", "x.gif", "image/gif", true)))
      .status,
    400
  );
  assert.ok(basic.calls.every(call => !call.path && !call.table));
  const paid = setup({ active: true });
  const response = await paid
    .load("app/api/profile-media/route.ts")
    .POST(imageRequest());
  assert.equal(response.status, 200);
  const upload = paid.calls.find(call => call.path);
  assert.match(
    upload.path,
    /^6c000000-0000-4000-8000-000000000001\/avatar-[a-f0-9-]+\.gif$/
  );
  assert.equal(upload.options.upsert, false);
  assert.equal(upload.options.contentType, "image/gif");
  assert.equal(
    paid.calls.find(call => call.table === "profile_media_assets").value
      .animated,
    true
  );
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
});
test("collection cover uploads require Pro and preserve inspected GIF bytes", async () => {
  const basic = setup();
  assert.equal(
    (
      await basic
        .load("app/api/profile-media/route.ts")
        .POST(imageRequest("collection-cover"))
    ).status,
    403
  );
  const paid = setup({ active: true });
  const response = await paid
    .load("app/api/profile-media/route.ts")
    .POST(imageRequest("collection-cover"));
  assert.equal(response.status, 200);
  const upload = paid.calls.find(call => call.path);
  assert.match(upload.path, /\/collection-cover-[a-f0-9-]+\.gif$/);
  assert.equal(upload.options.contentType, "image/gif");
  assert.equal(
    paid.calls.find(call => call.table === "profile_media_assets").value
      .purpose,
    "collection-cover"
  );
});

test("an account deletion committed during upload removes only the new immutable asset", async () => {
  const fixture = setup({ active: true, deletedDuringUpload: true });
  const response = await fixture
    .load("app/api/profile-media/route.ts")
    .POST(imageRequest());
  assert.equal(response.status, 403);
  const path = fixture.calls.find(call => call.path).path;
  assert.equal(fixture.calls.find(call => call.removed).removed.length, 1);
  assert.equal(fixture.calls.find(call => call.removed).removed[0], path);
  const reservation = fixture.calls.find(call => call.deleted);
  assert.equal(reservation.deleted, "profile_media_assets");
  assert.equal(reservation.value, path);
  assert.equal(reservation.nextValue, "6c000000-0000-4000-8000-000000000001");
  assert.doesNotMatch(await response.text(), /storage\/v1\/object/);
});

test("Basic can still upload a byte-validated static avatar without paid access", async () => {
  const basic = setup(),
    form = new FormData();
  const jpeg = Buffer.from([
    255, 216, 255, 224, 0, 0, 0, 0, 0, 0, 0, 0, 255, 217
  ]);
  form.set("purpose", "avatar");
  form.set("file", new File([jpeg], "photo.jpg", { type: "image/jpeg" }));
  const response = await basic.load("app/api/profile-media/route.ts").POST(
    new Request("http://localhost:3000/api/profile-media", {
      method: "POST",
      headers: { origin: "http://localhost:3000" },
      body: form
    })
  );
  assert.equal(response.status, 200);
  assert.equal(
    basic.calls.find(call => call.table === "profile_media_assets").value
      .animated,
    false
  );
  assert.equal(
    basic.calls.find(call => call.path).options.contentType,
    "image/jpeg"
  );
  assert.ok(basic.calls.every(call => call.name !== "billing_has_game_pro"));
});

test("#376: stale files are released before reserving; ban and quota have stable codes", async () => {
  const jpeg = Buffer.from([
    255, 216, 255, 224, 0, 0, 0, 0, 0, 0, 0, 0, 255, 217
  ]);
  const upload = async options => {
    const fixture = setup(options),
      form = new FormData();
    form.set("purpose", "avatar");
    form.set("file", new File([jpeg], "photo.jpg", { type: "image/jpeg" }));
    const response = await fixture.load("app/api/profile-media/route.ts").POST(
      new Request("http://localhost:3000/api/profile-media", {
        method: "POST",
        headers: { origin: "http://localhost:3000" },
        body: form
      })
    );
    return { response, calls: fixture.calls };
  };
  const user = "6c000000-0000-4000-8000-000000000001";
  const stale = [`${user}/old-unused.png`];
  const cleaned = await upload({ stale });
  assert.equal(cleaned.response.status, 200);
  const order = cleaned.calls.map(
    call =>
      call.name ??
      (call.removed ? "remove" : call.values ? "forget" : call.table)
  );
  assert.deepEqual(order.slice(0, 4), [
    "claim_stale_profile_media",
    "remove",
    "forget",
    "profile_media_assets"
  ]);
  assert.deepEqual(cleaned.calls[1].removed, stale);
  assert.deepEqual(cleaned.calls[2].values, stale);
  assert.equal(cleaned.calls[2].value, user);
  // Even if the database returned forged names, only own plain names are removed.
  const forged = await upload({
    stale: [
      `${user}/../6c000000-0000-4000-8000-000000000002/avatar.png`,
      `${user}/%2e%2e/avatar.png`,
      `${user}/sub/avatar.png`,
      `${user.toUpperCase()}/avatar.png`,
      "6c000000-0000-4000-8000-000000000002/avatar.png",
      `../card-images/${user}/avatar.png`,
      `${user}/avatar.svg`,
      42,
      `${user}/kept-valid.png`
    ]
  });
  assert.equal(forged.response.status, 200);
  assert.deepEqual(
    forged.calls.filter(call => call.removed).map(call => call.removed),
    [[`${user}/kept-valid.png`]]
  );
  const none = await upload({ stale: [`${user}/../x/avatar.png`] });
  assert.ok(none.calls.every(call => !call.removed && !call.values));
  for (const [code, status, message] of [
    ["ACCOUNT_BANNED", 403, "Your account is banned."],
    [
      "PROFILE_MEDIA_QUOTA_EXCEEDED",
      429,
      "You've reached your profile image upload limit. Try again later."
    ]
  ]) {
    const { response, calls } = await upload({ reserveError: code });
    assert.equal(response.status, status);
    assert.deepEqual(await response.json(), { code, error: message });
    assert.ok(
      calls.every(call => !call.path),
      "no bytes uploaded"
    );
  }
});

test("image inspector identifies APNG and animated WebP and rejects HTML/SVG/truncated content", () => {
  const { inspectProfileImage } = setup().load("lib/pro/image.ts");
  const chunk = (type, data) => {
    const b = Buffer.alloc(data.length + 12);
    b.writeUInt32BE(data.length);
    b.write(type, 4);
    data.copy(b, 8);
    return b;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1);
  header.writeUInt32BE(1, 4);
  const png = animated =>
    Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk("IHDR", header),
      ...(animated ? [chunk("acTL", Buffer.alloc(8))] : []),
      chunk("IEND", Buffer.alloc(0))
    ]);
  assert.equal(inspectProfileImage(png(false)).animated, false);
  assert.equal(inspectProfileImage(png(true)).animated, true);
  const body = Buffer.alloc(18);
  body.write("VP8X");
  body.writeUInt32LE(10, 4);
  body[8] = 2;
  const frame = Buffer.alloc(10);
  frame.write("ANMF");
  frame.writeUInt32LE(2, 4);
  const webp = Buffer.concat([Buffer.from("RIFF0000WEBP"), body, frame]);
  webp.writeUInt32LE(webp.length - 8, 4);
  assert.equal(inspectProfileImage(webp).animated, true);
  for (const input of [
    Buffer.from("<svg>not an image</svg>"),
    Buffer.from("<html>not an image</html>"),
    png(false).subarray(0, 20),
    Buffer.alloc(4194305)
  ])
    assert.throws(() => inspectProfileImage(input), /PROFILE_IMAGE_INVALID/);
});
test("operator setup validates provider before enabling the exact scope and fails closed", async () => {
  const env = {
    STRIPE_BILLING_MODE: "test",
    STRIPE_ACCOUNT_ID: "acct_fixture",
    STRIPE_PRO_PRICE_ID: "price_fixture",
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    SUPABASE_SECRET_KEY: "fixture-only"
  };
  const calls = [];
  const dependencies = {
    checkTest: async () => {
      calls.push("provider");
    },
    createClient: () => ({
      rpc: async (name, args) => {
        calls.push({ name, args });
        return { error: null };
      }
    })
  };
  assert.equal(
    (await configureProEntitlements(env, true, dependencies)).benefitsEnabled,
    true
  );
  assert.equal(calls[0], "provider");
  assert.deepEqual(calls[1], {
    name: "billing_set_entitlement_scope",
    args: { p_scope: "test:acct_fixture:price_fixture", p_enabled: true }
  });
  await assert.rejects(
    configureProEntitlements(
      { ...env, NEXT_PUBLIC_SUPABASE_URL: "https://api.yokkai-collec.com" },
      true,
      dependencies
    ),
    /CONFIGURATION_INVALID/
  );
  await assert.rejects(
    configureProEntitlements(env, true, {
      ...dependencies,
      checkTest: async () => {
        throw Error("STRIPE_SANDBOX_ACCOUNT_MISMATCH");
      }
    }),
    /ACCOUNT_MISMATCH/
  );
  assert.equal(calls.length, 2);
});
