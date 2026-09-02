import { Gallery } from "./Gallery";

export const metadata = { title: "Components — Keel dev" };

/**
 * Thin server-component entry for `/dev/components`. All the interactive state
 * lives in `<Gallery />` (a client component). `src/middleware.ts` gates this
 * route: public outside production, a bare 404 in production.
 */
export default function ComponentsPage() {
  return <Gallery />;
}
