import { PGlite } from "@electric-sql/pglite";
import { unaccent } from "@electric-sql/pglite/contrib/unaccent";
import { vector } from "@electric-sql/pglite/vector";
import { drizzle } from "drizzle-orm/pglite";

const pglite = new PGlite({
	dataDir: "./dbdata/",
	extensions: {
		unaccent,
		vector,
	},
});

export const db = drizzle({
	client: pglite,
});
