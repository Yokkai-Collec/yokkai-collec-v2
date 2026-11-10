import { readProfileSource } from "./helpers/profile-source.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { englishMessages, gameMessages } from "./helpers/i18n.mjs";

function setup() {
  const calls = [];
  const source = readFileSync(
    new URL("../lib/data/profile.ts", import.meta.url),
    "utf8"
  );
  const serverAvatar = source.includes("/api/profile-media");
  const context = {
    exports: {},
    FormData: class {
      fields = new Map();
      set(key, value) {
        this.fields.set(key, value);
      }
    },
    async fetch(url, { method, body }) {
      assert.equal(url, "/api/profile-media");
      assert.equal(method, "POST");
      assert.deepEqual([...body.fields.keys()].sort(), ["file", "purpose"]);
      const purpose = body.fields.get("purpose");
      assert.ok(["avatar", "banner"].includes(purpose));
      const file = body.fields.get("file");
      calls.push({
        path: `owner-id/${purpose}-server-validated.png`,
        size: file.size,
        options: { upsert: false, contentType: file.type }
      });
      return {
        ok: true,
        json: async () => ({
          url: `https://storage.test/avatars/owner-id/${purpose}-server-validated.png`
        })
      };
    },
    require(name) {
      if (name === "@/i18n/game-messages") return gameMessages;
      if (name === "@/utils/supabase/client")
        return {
          createClient: () => ({
            storage: {
              from(bucket) {
                assert.equal(bucket, "avatars");
                return {
                  async upload(path, file, options) {
                    calls.push({ path, size: file.size, options });
                    return { error: null };
                  },
                  getPublicUrl: path => ({
                    data: { publicUrl: `https://storage.test/avatars/${path}` }
                  })
                };
              }
            }
          })
        };
      if (
        [
          "@/lib/data/read-request",
          "@/lib/data/cards",
          "@/lib/data/player-state"
        ].includes(name)
      )
        return {};
      assert.fail(`Unexpected import ${name}`);
    }
  };
  vm.runInNewContext(
    ts.transpileModule(
      readFileSync(new URL("../lib/data/profile.ts", import.meta.url), "utf8"),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2020
        }
      }
    ).outputText,
    context
  );
  return { api: context.exports, calls, serverAvatar };
}

for (const [method, kind] of [
  ["uploadAvatar", "avatar"],
  ["uploadBanner", "banner"]
]) {
  test(`${kind} accepts images above the old limit and exactly 4 MB`, async () => {
    const { api, calls, serverAvatar } = setup();
    assert.equal(api.PROFILE_IMAGE_MAX_BYTES, 4194304);
    for (const size of [2097153, 3 * 1024 * 1024, 4194304]) {
      const result = await api[method](
        { size, type: "image/png", name: "photo.png" },
        "owner-id"
      );
      assert.match(
        result,
        new RegExp(
          serverAvatar
            ? `/owner-id/${kind}-server-validated\\.png$`
            : `/owner-id/${kind}\\.png\\?v=\\d+$`
        )
      );
    }
    assert.equal(calls.length, 3);
    for (const call of calls) {
      assert.equal(
        call.path,
        serverAvatar
          ? `owner-id/${kind}-server-validated.png`
          : `owner-id/${kind}.png`
      );
      assert.equal(call.options.upsert, !serverAvatar);
      assert.equal(call.options.contentType, "image/png");
    }
  });

  test(`${kind} rejects 4 MB + 1 byte before contacting storage`, async () => {
    const { api, calls } = setup();
    await assert.rejects(
      api[method](
        { size: 4194305, type: "image/png", name: "photo.png" },
        "owner-id"
      ),
      /4 MB or smaller/
    );
    assert.equal(calls.length, 0);
  });

  test(`${kind} keeps JPG, PNG, WebP, GIF and rejects other formats`, async () => {
    const { api, calls } = setup();
    for (const type of ["image/jpeg", "image/png", "image/webp", "image/gif"]) {
      await api[method](
        { size: 3 * 1024 * 1024, type, name: "photo.png" },
        "owner-id"
      );
    }
    for (const type of ["image/svg+xml", "application/pdf", "text/html", ""]) {
      await assert.rejects(
        api[method]({ size: 1024, type, name: "photo.svg" }, "owner-id"),
        /Use a JPG, PNG, WebP or GIF image/
      );
    }
    assert.equal(calls.length, 4);
  });
}

test("profile editor and previews advertise the new 4 MB limit", () => {
  const read = name =>
    name === "profile"
      ? readProfileSource()
      : readFileSync(
          new URL(`../components/${name}.tsx`, import.meta.url),
          "utf8"
        );
  assert.match(read("profile"), /t\("profileUi.jpgpngwebPOrGIFUpTo4"\)/);
  assert.match(englishMessages.profileUi.jpgpngwebPOrGIFUpTo4, /Up to 4 MB/);
  if (read("profile").includes("data-owned-banner-picker")) {
    assert.match(read("profile"), /t\("profileUi.bannerSourceHint"\)/);
    assert.match(
      englishMessages.profileUi.bannerSourceHint,
      /Choose a card from your collection/
    );
    assert.doesNotMatch(read("profile"), /Importer une bannière/);
  } else {
    assert.match(read("profile"), /up to 4 MB/);
  }
  assert.doesNotMatch(read("profile"), /2 Mo|2 MB/);
  assert.match(read("profile-preview"), /file.size > PROFILE_IMAGE_MAX_BYTES/);
  assert.match(read("social-preview"), /Up to 4 MB/);
});
