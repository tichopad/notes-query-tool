import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { after, before, test } from "node:test";
import { DbLoadRepository } from "../src/commands/load/load-repository.ts";
import { processLoadedFile } from "../src/commands/load/process-file.ts";
import { DbBaseRepository } from "../src/database/base-repository.ts";
import { createDbClient, type DbClient } from "../src/database/client.ts";
import { runMigrations } from "../src/database/migrate.ts";
import { type Embedder, initEmbedder } from "../src/embedder.ts";
import { chunkMarkdown } from "../src/files/chunker.ts";
import { loadFilesByGlob } from "../src/files/load-files.ts";
import { executeQuery, type QueryResult } from "../src/query/execute.ts";
import { fixtures } from "./fixtures.ts";

let embedder: Embedder;
let defaultBaseId: number;
let testDb: DbClient;

before(async () => {
	testDb = createDbClient("memory://");
	await runMigrations(testDb);
	const base = await new DbBaseRepository(testDb).getOrCreateBase("default");
	embedder = await initEmbedder();
	const repo = new DbLoadRepository(testDb);
	for await (const filePath of loadFilesByGlob("benchdata/**/*.md")) {
		const relPath = path.relative(process.cwd(), filePath);
		await processLoadedFile(relPath, {
			repo,
			baseId: base.id,
			readText: (p) => readFile(p, "utf8"),
			hashContent: (content) =>
				createHash("sha256").update(content).digest("hex"),
			chunkMarkdown,
			embedDocument: embedder.embedDocument.bind(embedder),
		});
	}
	defaultBaseId = base.id;
});

after(async () => {
	await testDb.$client.close();
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
			db: testDb,
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
