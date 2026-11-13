import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  ) {
    return new Response(null, { status: 404 });
  }
  const client = createClient(await cookies());
  const { data, error } = await client.rpc("get_catalogue_import_summary", {
    p_import_id: id
  });
  if (error) return new Response(null, { status: 503 });
  if (!data) return new Response(null, { status: 404 });
  return Response.json(
    { licenses: data },
    {
      headers: {
        "Cache-Control": "public, max-age=3600",
        "X-Content-Type-Options": "nosniff",
        "X-Robots-Tag": "noindex, nofollow"
      }
    }
  );
}
