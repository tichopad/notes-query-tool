import { fileURLToPath } from "node:url";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";

const migrationsFolder = fileURLToPath(
	new URL("../../drizzle", import.meta.url),
);

export async function runMigrations(db: PgliteDatabase): Promise<void> {
	await migrate(db, { migrationsFolder });
}
