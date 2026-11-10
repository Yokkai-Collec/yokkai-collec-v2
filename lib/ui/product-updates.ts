// Change the identifier only for a new published announcement.
export const PRODUCT_UPDATE_ID = "2026-11-profiles-showcases-missions";
export const PRODUCT_UPDATE_METADATA_KEY = "yokkai_last_seen_update";
export const productUpdateKey = (userId: string) =>
  `yokkai:update:${PRODUCT_UPDATE_ID}:${userId}`;

export function hasProductUpdateReceipt(
  storage: Pick<Storage, "getItem"> | null,
  userId: string
) {
  try {
    return storage?.getItem(productUpdateKey(userId)) === "1";
  } catch {
    return false;
  }
}
export function rememberProductUpdate(
  storage: Pick<Storage, "setItem"> | null,
  userId: string
) {
  try {
    storage?.setItem(productUpdateKey(userId), "1");
  } catch {
    /* In-memory receipt and the account receipt still work. */
  }
}
