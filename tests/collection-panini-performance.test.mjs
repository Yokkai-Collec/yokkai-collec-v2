import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const game = readFileSync(
  new URL("../components/game.tsx", import.meta.url),
  "utf8"
);
const collection = readFileSync(
  new URL("../components/collection.tsx", import.meta.url),
  "utf8"
);
const profile = readFileSync(
  new URL("../components/profile.tsx", import.meta.url),
  "utf8"
);
const catalogueModal = readFileSync(
  new URL("../components/catalogue-card-modal.tsx", import.meta.url),
  "utf8"
);
const collectionStyles = readFileSync(
  new URL("../styles/collection.css", import.meta.url),
  "utf8"
);

test("la collection normale ne télécharge plus le catalogue complet", () => {
  assert.doesNotMatch(game, /getAllCards/);
  assert.doesNotMatch(game, /getLicenseCatalogueTotals/);
  assert.match(game, /loadPaniniAlbums=\{getPaniniAlbumsPage\}/);
  assert.match(game, /loadPaniniAlbumCards=\{getPaniniAlbumCardsPage\}/);
  assert.match(game, /onSetPaniniAlbumFavorite=\{setPaniniAlbumFavorite\}/);
});

test("les classeurs personnels peuvent être placés en favoris", () => {
  assert.match(collection, /className="yk-panini-favorite"/);
  assert.match(collection, /aria-pressed=\{item\.favorite\}/);
  assert.match(collection, /togglePaniniAlbumFavorite/);
  assert.match(
    readFileSync(new URL("../lib/data/cards.ts", import.meta.url), "utf8"),
    /from\("panini_album_favorites"\)\s*\.insert\(/
  );
  assert.match(
    collection,
    /togglePaniniAlbumFavorite[^]*catch \(error\) \{[^]*setFavoriteError\(/
  );
  assert.match(
    collection,
    /onPointerDown=\{event =>\s*event\.stopPropagation\(\)\s*\}/
  );
  assert.match(
    collection,
    /onClick=\{event => \{\s*event\.stopPropagation\(\);[^]*togglePaniniAlbumFavorite/
  );
  assert.match(collectionStyles, /\.yk-panini-favorite\s*\{[^}]*z-index:\s*2;/);
  assert.match(collection, /tc\("favoritesOnly"\)/);
  assert.match(collection, /aria-pressed=\{favoritesOnly\}/);
  assert.match(collection, /favoritesOnly,/);
  assert.match(
    collection,
    /className="yk-panini-owned-toggle"[^]*favoritesOnly \? "✓" : "○"/
  );
});

test("les données Panini ne sont chargées que lorsque ce mode est ouvert", () => {
  assert.match(
    collection,
    /if \(viewMode !== "panini" \|\| selectedLicense \|\| !loadPaniniAlbums\)/
  );
  assert.match(
    collection,
    /if \(viewMode !== "panini" \|\| !selectedLicense \|\| !loadPaniniAlbumCards\)/
  );
});

test("les onglets Cartes et Classeurs ouvrent leur vue explicite et permettent le retour aux cartes", () => {
  assert.match(
    collection,
    /<nav className="yk-collection-tabs"[^]*aria-pressed={viewMode !== "panini"}[^]*setViewMode\("grid"\);\s*setSelectedLicense\(null\);[^]*{td\("cardsTab"\)}/
  );
  assert.match(collection, /<h2>\{tc\("myLicenseBinders"\)\}<\/h2>/);
  assert.doesNotMatch(
    collection,
    /Album Panini|Mode Panini|Mes albums par licence|Tous les albums|Chargement des albums/
  );
  assert.match(
    collection,
    /className="yk-panini-mode"\s*aria-pressed={viewMode === "panini"}[^]*navigateBinder\(\);[^]*{td\("bindersTab"\)}/
  );
});

test("la collection d'un ami reçoit ses propres chargeurs Panini", () => {
  assert.match(profile, /getFriendPaniniAlbumsPage\(profile\.id, options\)/);
  assert.match(
    profile,
    /getFriendPaniniAlbumCardsPage\(profile\.id, options\)/
  );
  assert.match(
    profile,
    /loadPaniniAlbums=\{loadFriendPaniniAlbums\}[^]*loadPaniniAlbumCards=\{loadFriendPaniniAlbumCards\}[^]*readOnly/
  );
});

test("les cartes manquantes du Classeur restent visibles en niveaux de gris", () => {
  assert.match(
    collection,
    /className="yk-panini-missing"[^]*onClick=\{\(\) => setSelectedMissingCard\(card\)\}[^]*aria-haspopup="dialog"[^]*<CardShell interactive=\{false\}>[^]*<YokaiCard[^]*\.\.\.card[^]*animated=\{false\}[^]*className="yk-panini-missing-card"/
  );
  assert.match(
    collection,
    /<CatalogueCardModal[^]*selected=\{selectedMissingCard\}[^]*onClose=\{\(\) => setSelectedMissingCard\(null\)\}/
  );
  assert.match(catalogueModal, /tv\("currentOwners"\)/);
  assert.match(catalogueModal, /tv\("addToMyWishlist"\)/);
  assert.match(
    catalogueModal,
    /getCardDiscovery\(cardId, 0, 12, !!selected\.shiny\)/
  );
  assert.doesNotMatch(collection, /<span>\?<\/span>/);
  assert.doesNotMatch(collection, />Non possédée</);
});
