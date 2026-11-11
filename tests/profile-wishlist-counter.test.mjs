import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { englishMessages } from "./helpers/i18n.mjs";

test("current profile has one private-aware wishlist entry point and no view recorder", () => {
  const source = readFileSync(
    new URL("../components/profile.tsx", import.meta.url),
    "utf8"
  );
  const api = readFileSync(
    new URL("../lib/data/profile.ts", import.meta.url),
    "utf8"
  );
  const preview = readFileSync(
    new URL("../components/profile-preview.tsx", import.meta.url),
    "utf8"
  );
  for (const code of [source, api, preview]) {
    assert.doesNotMatch(
      code,
      /recordProfileView|record_profile_view|recordView|visitIds|countedVisits/
    );
  }
  assert.doesNotMatch(source, /data-profile-views|Vues du profil/);
  assert.doesNotMatch(
    source,
    /\["wishlist", "Wishlist"\]|tab !== "wishlist"|wishlistLimit/
  );
  assert.equal(source.match(/data-profile-wishlist/g)?.length, 1);
  assert.match(
    source,
    /<button[\s\S]*?onClick=\{\(\) => setWishlistOpen\(true\)\}[\s\S]*?disabled=\{!profile.canViewCollection\}[\s\S]*?data-profile-wishlist[\s\S]*?aria-haspopup="dialog"/
  );
  assert.match(source, /open=\{wishlistOpen && profile.canViewCollection\}/);
  assert.match(
    source,
    /title=\{t\("profileUi.wishlistFor",\s*\{\s*name: profile.pseudo\s*\}\)\}/
  );
  assert.equal(englishMessages.profileUi.wishlistFor, "{name}’s wishlist");
  assert.match(source, /<FriendWishlist\s+cards=\{wishlist\}/);
  assert.match(
    source,
    /profile.canViewCollection\s+\? fmt.number\(wishlist.length\)\s+: t\("profileUi.private"\)/
  );
  assert.equal(englishMessages.profileUi.private, "Private");
  assert.match(source, /data-profile-likes/);
  assert.match(
    source,
    /const showInlineProfileLike =\s*!isMe && profile\.friendshipStatus !== "accepted"/
  );
  assert.match(source, /has-profile-like/);
  assert.match(
    api,
    /export type ProfileEngagement = \{likes:number;likedByMe:boolean\}/
  );
  assert.match(source, /adapter.engagement\(profileId\)/);
});
