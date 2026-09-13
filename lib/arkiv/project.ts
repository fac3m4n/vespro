/**
 * Project identity in a shared database.
 *
 * Every Arkiv entity on Tiramisu lives in one public namespace, so a project that does
 * not tag its own rows will read everyone else's. `kind = "listing"` is precisely the
 * name two teams pick independently, and a buyer's browse would then show datasets that
 * were never Vespro listings at all.
 *
 * This is a *label*, and anyone can write one. It separates namespaces; it does not
 * establish trust. Trust comes from `$creator`, which is immutable — see
 * `trustedCreator()` in `client.ts` and its use in every read in `entities.ts`.
 */
export const PROJECT_ATTRIBUTE_NAME = "project" as const;

/** Globally unique, and lowercase to match the attribute-name charset the engine
 *  accepts — see the snake_case warning at the top of `arkiv/schema.md`. */
export const PROJECT_ATTRIBUTE_VALUE = "vespro-ethrome-2026-q7f3" as const;
