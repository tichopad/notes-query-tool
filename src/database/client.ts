import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { unaccent } from "@electric-sql/pglite/contrib/unaccent";
import { vector } from "@electric-sql/pglite/vector";
import { drizzle } from "drizzle-orm/pglite";
import { DB_DATA_DIR } from "../config.ts";

const pglite = new PGlite({
	dataDir: DB_DATA_DIR,
	extensions: {
		unaccent,
		vector,
		pg_trgm,
	},
});

export const db = drizzle({
	client: pglite,
});
