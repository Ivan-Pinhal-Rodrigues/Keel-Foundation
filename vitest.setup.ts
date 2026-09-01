// Vitest global setup.
//
// Load .env so DATABASE_URL / MIGRATE_DATABASE_URL (and the rest) reach every
// test file and the per-file disposable-schema harness in src/test/db.ts.
// Next.js loads .env itself at runtime; Vitest does not, hence this.
//
// `quiet: true` suppresses dotenv 17's "injected env" banner — ESM import
// hoisting means DOTENV_CONFIG_QUIET set here would run too late, so the
// programmatic form is used instead of `import "dotenv/config"`.
import { config } from "dotenv";

config({ quiet: true });
