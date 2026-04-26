import { beforeAll, expect, test } from "bun:test";
import { count } from "drizzle-orm";
import { db } from "../src/database/client";
import { chunksTable } from "../src/database/schema/chunks";
import { initEmbedder } from "../src/embedder";
import { executeQuery, type QueryResult } from "../src/query/execute";
import { fixtures } from "./fixtures";

let embed: (s: string) => Promise<number[]>;

beforeAll(async () => {
	const [row] = await db.select({ count: count() }).from(chunksTable);
	if (!row?.count)
		throw new Error("DB empty. Seed: bun dev load --glob 'testdata/**/*.md'");
	embed = await initEmbedder();
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
	fx: { name: string; query: string; expectedFiles: string[] },
	results: QueryResult[],
	rank: number,
	mrr: number,
): void {
	console.log(`\n--- ${fx.name} ---`);
	console.log(`Query:    ${fx.query}`);
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
			queryText: fx.query,
			embedder: embed,
			topK: 10,
		});
		const rank = firstRelevantRank(results, fx.expectedFiles);
		const mrr = rank === Infinity ? 0 : 1 / rank;
		logTable(fx, results, rank, mrr);
		expect(mrr).toBeGreaterThanOrEqual(fx.minMrr ?? 0.5);
	});
}
