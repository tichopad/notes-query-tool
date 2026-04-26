import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { unaccent } from "@electric-sql/pglite/contrib/unaccent";
import { vector } from "@electric-sql/pglite/vector";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";

const pglite = new PGlite({
	dataDir: "./dbdata/",
	extensions: {
		unaccent,
		vector,
		pg_trgm,
	},
});

const db = drizzle({ client: pglite });

await migrate(db, { migrationsFolder: "./drizzle" });
await pglite.close();
console.log("Migrations applied successfully.");
