import { readProfileSource } from "./helpers/profile-source.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { gameMessages } from "./helpers/i18n.mjs";

function setup(error = null) {
  const calls = [];
  const exports = {};
  vm.runInNewContext(
    ts.transpileModule(
      readFileSync(new URL("../lib/data/profile.ts", import.meta.url), "utf8"),
      { compilerOptions: { module: ts.ModuleKind.CommonJS } }
    ).outputText,
    {
      exports,
      require(name) {
        if (name === "@/i18n/game-messages") return gameMessages;
        if (name === "@/utils/supabase/client")
          return {
            createClient: () => ({
              rpc: async (name, args) => {
                calls.push({ name, args });
                return {
                  error,
                  data: {
                    id: "owner",
                    bannerCard: null,
                    featuredCards: [],
                    friends: [],
                    friendshipStatus: "self",
                    bannerUrl: args.p_banner_url,
                    bannerFrame: args.p_banner_frame
                  }
                };
              }
            })
          };
        if (name === "@/lib/data/cards")
          return { withLiveCardFranchises: async cards => cards };
        if (name === "@/lib/data/player-state")
          return { publishPlayerSnapshotInvalidation: () => {} };
        if (name === "@/lib/data/read-request") return {};
        throw Error(name);
      }
    }
  );
  return { api: exports, calls };
}

test("profile saves send framing in the same atomic RPC as the banner and preserve returned metadata", async () => {
  const { api, calls } = setup();
  const frame = { x: 30, y: 70, zoom: 0.5 };
  const result = await api.saveProfileAppearance(
    "Bio",
    null,
    [],
    "card",
    null,
    frame
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, "update_profile_appearance_framed");
  assert.equal(calls[0].args.p_banner_card_id, "card");
  assert.deepEqual(calls[0].args.p_banner_frame, frame);
  assert.deepEqual(result.bannerFrame, frame);
  assert.equal(result.bannerUrl, null);
});

test("legacy appearance saves keep their exact RPC contract", async () => {
  const { api, calls } = setup();
  await api.saveProfileAppearance(
    "Bio",
    null,
    [],
    null,
    "https://example.test/banner.gif"
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, "update_profile_appearance");
  assert.equal("p_banner_frame" in calls[0].args, false);
});

test("missing migration or invalid framing never silently discards the requested crop", async () => {
  for (const [error, message] of [
    [{ code: "PGRST202" }, /not available yet/],
    [{ message: "BANNER_FRAME_INVALID" }, /crop is invalid/]
  ]) {
    const { api, calls } = setup(error);
    await assert.rejects(
      api.saveProfileAppearance("Bio", null, [], "card", null, {
        x: 50,
        y: 50,
        zoom: 1
      }),
      message
    );
    assert.equal(calls.length, 1, "no unsafe fallback without the crop");
  }
});

test("the editor checks migration availability before uploading a cropped image", () => {
  const source = readProfileSource();
  const submit = source.slice(
    source.indexOf("async function submit()"),
    source.indexOf("return (", source.indexOf("async function submit()"))
  );
  assert.match(submit, /if \(bannerFrame && !framingAvailable\)/);
  if (source.includes("data-banner-upload")) {
    assert.ok(
      submit.indexOf("!framingAvailable") <
        submit.indexOf("adapter.uploadBanner")
    );
    assert.match(submit, /bannerFile/);
    assert.match(source, /ownedBannerChoices/);
  } else if (source.includes("data-owned-banner-picker")) {
    assert.ok(
      submit.indexOf("!framingAvailable") <
        submit.indexOf("adapter.saveAppearance")
    );
    assert.doesNotMatch(submit, /uploadBanner|bannerFile/);
    const editor = source.slice(
      source.indexOf("function Editor("),
      source.indexOf("const wishlistRarities")
    );
    assert.doesNotMatch(
      editor,
      /adapter\.search|searchCards|createObjectURL|Importer une bannière/
    );
    assert.match(editor, /ownedBannerChoices/);
  } else {
    assert.ok(
      submit.indexOf("!framingAvailable") <
        submit.indexOf("adapter.uploadBanner")
    );
  }
  assert.match(
    source,
    /framingAvailable=\{\s*!!adapter\.saveAppearance\s*\|\|\s*details\.bannerFrame !== undefined\s*\}/
  );
});
