import { fetchEntity } from "@/lib/arkiv/entities";

export async function GET(request: Request) {
  const key = new URL(request.url).searchParams.get("key") as `0x${string}` | null;
  if (!key) return Response.json({ error: "key is required" }, { status: 400 });

  const entity = await fetchEntity(key);

  // Absent covers both "never existed" and "expired". The caller does not need to
  // tell those apart, and Vespro does not store enough to let it.
  if (!entity) return Response.json({ error: "no live entity with that key" }, { status: 404 });

  return Response.json(entity);
}
