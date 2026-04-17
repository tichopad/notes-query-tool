import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite/vector";
import { drizzle } from "drizzle-orm/pglite";

const pglite = new PGlite({
	dataDir: "./dbdata/",
	extensions: { vector },
});

export const db = drizzle({
	client: pglite,
});
