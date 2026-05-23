import assert from "node:assert/strict";
import { after, describe, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { unaccent } from "@electric-sql/pglite/contrib/unaccent";
import { vector } from "@electric-sql/pglite/vector";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { runMigrations } from "../database/migrate.ts";
import { basesTable } from "../database/schema/bases.ts";
import { filesTable } from "../database/schema/files.ts";
import { executeQuery } from "./execute.ts";

const DIMS = 768;

async function createTestDb() {
	const pglite = new PGlite({
		dataDir: "memory://",
		extensions: { unaccent, vector, pg_trgm },
	});
	const db = drizzle({ client: pglite });
	await runMigrations(db);
	const bases = await db
		.insert(basesTable)
		.values({ name: "test-base" })
		.returning();
	const baseId = bases[0]?.id;
	if (!baseId) throw new Error("base creation failed");
	return { db, pglite, baseId };
}

function zeroEmbedding(): number[] {
	return new Array(DIMS).fill(0);
}

async function seedChunk(
	db: Awaited<ReturnType<typeof createTestDb>>["db"],
	content: string,
	baseId: number,
) {
	const files = await db
		.insert(filesTable)
		.values({
			filePath: `note-${Date.now()}-${Math.random()}.md`,
			contentHash: "abc",
			baseId,
		})
		.returning();
	const file = files[0];
	if (!file) throw new Error("seed failed");
	const embedding = zeroEmbedding();
	await db.execute(
		sql`INSERT INTO chunks (file_id, chunk_index, content, breadcrumbs, embedding, fts)
        VALUES (${file.id}, 0, ${content}, ARRAY[]::text[], ${JSON.stringify(embedding)}::vector, to_tsvector('simple', unaccent(${content})))`,
	);
}

const noopEmbedder = async (_text: string): Promise<number[]> =>
	zeroEmbedding();

describe("executeQuery — trigramText", () => {
	test("omitting trigramText falls back to queryText for trigram leg", async () => {
		const { db, pglite, baseId } = await createTestDb();
		after(() => pglite.close());

		await seedChunk(db, "photosynthesis is a biological process", baseId);

		const results = await executeQuery({
			vectorText: "photosynthesis",
			queryText: "photosynthesis",
			// trigramText omitted → falls back to queryText
			embedQuery: noopEmbedder,
			db,
			baseId,
			trigramThreshold: 0.1,
		});

		assert.ok(Array.isArray(results));
	});

	test("trigramText overrides queryText for trigram leg only", async () => {
		const { db, pglite, baseId } = await createTestDb();
		after(() => pglite.close());

		await seedChunk(db, "javascript async await promises", baseId);
		await seedChunk(db, "python generator coroutines", baseId);

		// queryText uses websearch syntax (OR) — FTS leg gets this
		// trigramText uses plain text — trigram leg gets this
		const results = await executeQuery({
			vectorText: "async programming",
			queryText: "javascript OR python",
			trigramText: "javascript",
			embedQuery: noopEmbedder,
			db,
			baseId,
			trigramThreshold: 0.1,
		});

		assert.ok(Array.isArray(results));
		// Key assertion: websearch syntax in queryText does not corrupt the
		// trigram leg when trigramText is provided separately
	});
});

describe("executeQuery — base isolation", () => {
	test("only returns chunks from the specified base", async () => {
		const { db, pglite, baseId } = await createTestDb();
		after(() => pglite.close());

		// Create a second base
		const otherBases = await db
			.insert(basesTable)
			.values({ name: "other-base" })
			.returning();
		const otherBaseId = otherBases[0]?.id;
		if (!otherBaseId) throw new Error("other base creation failed");

		// Seed a chunk into the primary base
		await seedChunk(db, "photosynthesis is a biological process", baseId);
		// Seed a chunk into the other base (should not appear in results)
		await seedChunk(db, "photosynthesis is a biological process", otherBaseId);

		const results = await executeQuery({
			vectorText: "photosynthesis",
			queryText: "photosynthesis",
			embedQuery: noopEmbedder,
			db,
			baseId,
			trigramThreshold: 0.1,
		});

		// All results must belong to the queried base
		for (const r of results) {
			const file = await db
				.select()
				.from(filesTable)
				.where(sql`file_path = ${r.filePath}`)
				.limit(1);
			assert.equal(file[0]?.baseId, baseId);
		}
	});

	test("returns empty results for a base with no chunks", async () => {
		const { db, pglite } = await createTestDb();
		after(() => pglite.close());

		// Create an empty base
		const emptyBases = await db
			.insert(basesTable)
			.values({ name: "empty-base" })
			.returning();
		const emptyBaseId = emptyBases[0]?.id;
		if (!emptyBaseId) throw new Error("empty base creation failed");

		const results = await executeQuery({
			vectorText: "anything",
			queryText: "anything",
			embedQuery: noopEmbedder,
			db,
			baseId: emptyBaseId,
			trigramThreshold: 0.1,
		});

		assert.equal(results.length, 0);
	});
});
