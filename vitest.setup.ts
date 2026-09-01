// Vitest global setup.
//
// Load .env so DATABASE_URL / MIGRATE_DATABASE_URL (and the rest) reach every
// test file and the per-file disposable-schema harness in src/test/db.ts.
// Next.js loads .env itself at runtime; Vitest does not, hence this.
import "dotenv/config";
