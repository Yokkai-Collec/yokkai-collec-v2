"use client";
import { useEffect } from "react";
import { recordFriendVisit } from "@/lib/data/missions";
// Count a mounted profile page, never a prefetched page or a hover preview.
// The server checks accepted friendship and deduplicates the game day.
export function MissionProfileVisit({ identifier }: { identifier: string }) {
  useEffect(() => {
    void recordFriendVisit(identifier).catch(() => undefined);
  }, [identifier]);
  return null;
}
