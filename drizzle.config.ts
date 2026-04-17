import { defineConfig } from "drizzle-kit";

export default defineConfig({
	dbCredentials: {
		url: "./dbdata/",
	},
	dialect: "postgresql",
	driver: "pglite",
	schema: "./src/database/schema",
	out: "./drizzle",
});
