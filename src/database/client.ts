import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { unaccent } from "@electric-sql/pglite/contrib/unaccent";
import { vector } from "@electric-sql/pglite/vector";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { DB_DATA_DIR } from "../config.ts";

export type { PgliteDatabase };

export const DB_EXTENSIONS = {
	unaccent,
	vector,
	pg_trgm,
};

export type DbClient = PgliteDatabase & { $client: PGlite };

export function createDbClient(dataDir: string = DB_DATA_DIR): DbClient {
	const pglite = new PGlite({
		dataDir,
		extensions: DB_EXTENSIONS,
	});
	return drizzle({ client: pglite });
}

export const db: DbClient = createDbClient();
