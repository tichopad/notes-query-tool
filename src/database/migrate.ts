import { fileURLToPath } from "node:url";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { logger } from "../logger.ts";

const migrationsFolder = fileURLToPath(
	new URL("../../drizzle", import.meta.url),
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
