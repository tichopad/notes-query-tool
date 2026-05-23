import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { count } from "drizzle-orm";
import { db } from "../src/database/client.ts";
import { basesTable } from "../src/database/schema/bases.ts";
import { chunksTable } from "../src/database/schema/chunks.ts";
import { type Embedder, initEmbedder } from "../src/embedder.ts";
import { executeQuery, type QueryResult } from "../src/query/execute.ts";
import { fixtures } from "./fixtures.ts";

let embedder: Embedder;
let defaultBaseId: number;

before(async () => {
	const [row] = await db.select({ count: count() }).from(chunksTable);
	if (!row?.count) throw new Error("DB empty. Seed: pnpm run benchdata:load");
	embedder = await initEmbedder();
	const [base] = await db.select().from(basesTable).limit(1);
	if (!base) throw new Error("No base found. Seed bench data first.");
	defaultBaseId = base.id;
});

after(async () => {
	await db.$client.close();
});

function firstRelevantRank(
	results: QueryResult[],
	expectedFiles: string[],
): number {
	for (let i = 0; i < results.length; i++) {
		const r = results[i];
		if (r && expectedFiles.includes(r.filePath)) {
			return i + 1;
		}
	}
	return Infinity;
}

function logTable(
	fx: {
		name: string;
		vectorQuery: string;
		ftsQuery: string;
		expectedFiles: string[];
	},
	results: QueryResult[],
	rank: number,
	mrr: number,
): void {
	console.log(`\n--- ${fx.name} ---`);
	console.log(`Vector:   ${fx.vectorQuery}`);
	console.log(`FTS:      ${fx.ftsQuery}`);
	console.log(`Expected: ${fx.expectedFiles.join(", ")}`);
	console.log(
		`MRR:      ${mrr === 0 ? "0 (not found)" : mrr.toFixed(4)}  Rank: ${rank === Infinity ? "∞" : rank}`,
	);
	console.log("Top-10:");
	for (let i = 0; i < results.length; i++) {
		const r = results[i];
		if (!r) continue;
		const hit = fx.expectedFiles.includes(r.filePath);
		const marker = hit ? "★" : " ";
		console.log(
			`  ${marker} ${String(i + 1).padStart(2)}. [${r.score.toFixed(4)}] ${r.filePath}`,
		);
	}
}

for (const fx of fixtures) {
	test(`retrieval: ${fx.name}`, async () => {
		const results = await executeQuery({
			vectorText: fx.vectorQuery,
			queryText: fx.ftsQuery,
			embedQuery: embedder.embedQuery.bind(embedder),
			topK: 10,
			baseId: defaultBaseId,
		});
		const rank = firstRelevantRank(results, fx.expectedFiles);
		const mrr = rank === Infinity ? 0 : 1 / rank;
		logTable(fx, results, rank, mrr);
		const minMrr = fx.minMrr ?? 0.5;
		assert.ok(mrr >= minMrr, `${mrr} >= ${minMrr}`);
	});
}
