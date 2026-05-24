import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { logger } from "../logger.ts";

// MIGRATIONS_RELATIVE_PATH is replaced at build time by esbuild (see scripts/build.ts).
// In development (running source directly), it falls back to "../../drizzle" which is
// correct relative to src/database/migrate.ts.
declare const MIGRATIONS_RELATIVE_PATH: string;
const migrationsRelativePath =
	typeof MIGRATIONS_RELATIVE_PATH !== "undefined"
		? MIGRATIONS_RELATIVE_PATH
		: "../../drizzle";

const migrationsFolder = join(
	fileURLToPath(new URL(".", import.meta.url)),
	migrationsRelativePath,
);

export async function runMigrations(db: PgliteDatabase): Promise<void> {
	try {
		logger.debug("Running DB migrations...");
		await migrate(db, { migrationsFolder });
		logger.debug("Migrations complete");
	} catch (err) {
		throw new Error(
			`Migration failed: ${err instanceof Error ? err.message : String(err)}`,
			{ cause: err },
		);
	}
}
