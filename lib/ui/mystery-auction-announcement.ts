// Change the identifier only for a new published announcement.
export const MYSTERY_ANNOUNCEMENT_ID = "2026-11-mystery-twice-daily-lr";
export const MYSTERY_ANNOUNCEMENT_METADATA_KEY =
  "yokkai_seen_mystery_auction_announcement";
export const mysteryAnnouncementKey = (userId: string) =>
  `yokkai:mystery-announcement:${MYSTERY_ANNOUNCEMENT_ID}:${userId}`;

export function hasMysteryAnnouncementReceipt(
  storage: Pick<Storage, "getItem"> | null,
  userId: string
) {
  try {
    return storage?.getItem(mysteryAnnouncementKey(userId)) === "1";
  } catch {
    return false;
  }
}
export function rememberMysteryAnnouncement(
  storage: Pick<Storage, "setItem"> | null,
  userId: string
) {
  try {
    storage?.setItem(mysteryAnnouncementKey(userId), "1");
  } catch {
    /* In-memory receipt and the account receipt still work. */
  }
}

// Retire the launch announcement instead of showing old news to new accounts.
export function isMysteryAnnouncementActive(now = Date.now()) {
  return now < Date.parse("2026-12-01T23:00:00Z");
}
