"use server";

import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import {
  PACKS_MARKET_ANNOUNCEMENT_ID,
  PACKS_MARKET_ANNOUNCEMENT_METADATA_KEY
} from "@/lib/ui/packs-market-announcement";

export async function acknowledgePacksMarketAnnouncement() {
  const client = createClient(await cookies());
  const {
    data: { user }
  } = await client.auth.getUser();
  if (
    !user ||
    user.user_metadata?.[PACKS_MARKET_ANNOUNCEMENT_METADATA_KEY] ===
      PACKS_MARKET_ANNOUNCEMENT_ID
  )
    return;
  await client.auth.updateUser({
    data: {
      [PACKS_MARKET_ANNOUNCEMENT_METADATA_KEY]: PACKS_MARKET_ANNOUNCEMENT_ID
    }
  });
}
