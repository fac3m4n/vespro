import { addresses } from "@/lib/arkiv/entities";

/** The two demo wallet addresses. Addresses only — the keys stay server-side. */
export async function GET() {
  try {
    return Response.json(addresses());
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "unknown error" },
      { status: 500 },
    );
  }
}
