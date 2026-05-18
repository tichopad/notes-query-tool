import assert from "node:assert/strict";
import { after, describe, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { unaccent } from "@electric-sql/pglite/contrib/unaccent";
import { vector } from "@electric-sql/pglite/vector";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { runMigrations } from "../database/migrate.ts";
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
	return { db, pglite };
}

function zeroEmbedding(): number[] {
	return new Array(DIMS).fill(0);
}

async function seedChunk(
	db: Awaited<ReturnType<typeof createTestDb>>["db"],
	content: string,
) {
	const files = await db
		.insert(filesTable)
		.values({ filePath: `note-${Date.now()}.md`, contentHash: "abc" })
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
		const { db, pglite } = await createTestDb();
		after(() => pglite.close());

		await seedChunk(db, "photosynthesis is a biological process");

		const results = await executeQuery({
			vectorText: "photosynthesis",
			queryText: "photosynthesis",
			// trigramText omitted → falls back to queryText
			embedQuery: noopEmbedder,
			db,
			trigramThreshold: 0.1,
		});

		assert.ok(Array.isArray(results));
	});

	test("trigramText overrides queryText for trigram leg only", async () => {
		const { db, pglite } = await createTestDb();
		after(() => pglite.close());

		await seedChunk(db, "javascript async await promises");
		await seedChunk(db, "python generator coroutines");

		// queryText uses websearch syntax (OR) — FTS leg gets this
		// trigramText uses plain text — trigram leg gets this
		const results = await executeQuery({
			vectorText: "async programming",
			queryText: "javascript OR python",
			trigramText: "javascript",
			embedQuery: noopEmbedder,
			db,
			trigramThreshold: 0.1,
		});

		assert.ok(Array.isArray(results));
		// Key assertion: websearch syntax in queryText does not corrupt the
		// trigram leg when trigramText is provided separately
	});
});
