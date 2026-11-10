import { readProfileSource } from "./helpers/profile-source.mjs";
import { gameMessages, englishMessages } from "./helpers/i18n.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = readProfileSource();
const editor = source.slice(
  source.indexOf("function Editor("),
  source.indexOf("const wishlistRarities")
);
// Translation key names are not executable calls to the remote card search.
const editorCode = editor.replace(/\bt\("[a-zA-Z.0-9]+"\)/g, "t()");

test("banner choices are deduplicated owned catalogue images, searched locally with bounded results", () => {
  assert.match(editor, /for \(const card of collection\)/);
  assert.match(editor, /!cards\.has\(card\.id\)/);
  assert.match(editor, /image: card\.catalogueImage/);
  assert.match(editor, /matchesCardSearch\(bannerQuery/);
  assert.match(editor, /ownedBannerChoices\.slice\(0, 36\)\.map/);
  assert.match(editor, /data-owned-banner-picker/);
  const galleryEnabled = editor.includes("data-banner-upload");
  assert.match(
    editor,
    galleryEnabled
      ? /t\("profileUi\.collectACardToUseItAsA"\)/
      : /Collect a card to unlock a profile banner/
  );
  assert.equal(
    englishMessages.profileUi.collectACardToUseItAsA,
    "Collect a card to use it as a profile banner, or upload an image."
  );
  assert.doesNotMatch(editorCode, /searchCards|adapter\.search/);
  if (galleryEnabled) {
    assert.match(editor, /adapter\.uploadBanner/);
    assert.match(editor, /URL\.createObjectURL/);
    assert.match(editor, /URL\.revokeObjectURL/);
    assert.equal((editor.match(/type="file"/g) ?? []).length, 2);
  } else {
    assert.doesNotMatch(
      editor,
      /searchCards|adapter\.search|uploadBanner|createObjectURL|bannerFile/
    );
    assert.equal(
      (editor.match(/type="file"/g) ?? []).length,
      1,
      "only avatar upload remains"
    );
  }
  assert.match(editor, /<BannerCrop/);
  assert.match(editor, /setBannerCard\(crop\.card\)/);
});

test("banner policy errors stay actionable in English without retrying the old RPC", async () => {
  for (const message of ["BANNER_CARD_NOT_OWNED", "BANNER_URL_DISABLED"]) {
    let calls = 0;
    const exports = {};
    vm.runInNewContext(
      ts.transpileModule(
        readFileSync(
          new URL("../lib/data/profile.ts", import.meta.url),
          "utf8"
        ),
        { compilerOptions: { module: ts.ModuleKind.CommonJS } }
      ).outputText,
      {
        exports,
        require(name) {
          if (name === "@/i18n/game-messages") return gameMessages;
          if (name === "@/utils/supabase/client")
            return {
              createClient: () => ({
                rpc: async () => {
                  calls++;
                  return { error: { message }, data: null };
                }
              })
            };
          if (
            [
              "@/lib/data/cards",
              "@/lib/data/player-state",
              "@/lib/data/read-request"
            ].includes(name)
          )
            return {};
          throw Error(name);
        }
      }
    );
    await assert.rejects(
      exports.saveProfileAppearance("Bio", null, [], "card", null, {
        x: 50,
        y: 50,
        zoom: 1
      }),
      /Choose a card you own from your collection/
    );
    assert.equal(calls, 1);
  }
});
