import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const headers = { "Cache-Control": "private, no-store" };
  const notFound = () => new Response(null, { status: 404, headers });
  if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id))
    return notFound();

  const { data, error } = await createClient(await cookies()).rpc(
    "get_private_message_image",
    { p_message_id: id }
  );
  if (
    error ||
    !data ||
    typeof data.data !== "string" ||
    !["image/png", "image/jpeg", "image/gif", "image/webp"].includes(data.type)
  )
    return notFound();

  return new Response(Buffer.from(data.data, "base64"), {
    headers: {
      ...headers,
      "Content-Type": data.type,
      "X-Content-Type-Options": "nosniff",
      "Cross-Origin-Resource-Policy": "same-origin"
    }
  });
}
