import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { unaccent } from "@electric-sql/pglite/contrib/unaccent";
import { vector } from "@electric-sql/pglite/vector";
import { drizzle } from "drizzle-orm/pglite";
import { DbBaseRepository } from "./base-repository.ts";
import { runMigrations } from "./migrate.ts";

async function createTestDb() {
	const pglite = new PGlite({
		dataDir: "memory://",
		extensions: { unaccent, vector, pg_trgm },
	});
	const db = drizzle({ client: pglite });
	await runMigrations(db);
	return { db, pglite };
}

describe("DbBaseRepository", () => {
	let repo: DbBaseRepository;
	let pglite: PGlite;

	before(async () => {
		const result = await createTestDb();
		pglite = result.pglite;
		repo = new DbBaseRepository(result.db);
	});

	after(async () => {
		await pglite.close();
	});

	test("getBaseByName returns undefined for a nonexistent base", async () => {
		const result = await repo.getBaseByName("nonexistent_base_xyz");
		assert.equal(result, undefined);
	});

	test("getOrCreateBase creates on first call, returns existing on second call", async () => {
		const name = `test_base_${Date.now()}`;
		const first = await repo.getOrCreateBase(name);
		assert.ok(first.id, "should have an id");
		assert.equal(first.name, name);

		const second = await repo.getOrCreateBase(name);
		assert.equal(second.id, first.id, "should return the same record");
		assert.equal(second.name, name);
	});
});
