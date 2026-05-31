import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
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

// ── helpers ──────────────────────────────────────────────────────────

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

// ── main ─────────────────────────────────────────────────────────────

async function main() {
	// Setup: in-memory DB + embedder + load benchdata
	const testDb: DbClient = createDbClient("memory://");
	await runMigrations(testDb);
	const base = await new DbBaseRepository(testDb).getOrCreateBase("default");
	const embedder: Embedder = await initEmbedder();
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

	console.log("\n=== Retrieval Benchmarks ===\n");

	// Run each fixture
	let passed = 0;
	let failed = 0;

	for (const fx of fixtures) {
		const results = await executeQuery({
			vectorText: fx.vectorQuery,
			queryText: fx.ftsQuery,
			embedQuery: embedder.embedQuery.bind(embedder),
			db: testDb,
			topK: 10,
			baseId: base.id,
		});
		const rank = firstRelevantRank(results, fx.expectedFiles);
		const mrr = rank === Infinity ? 0 : 1 / rank;
		const minMrr = fx.minMrr ?? 0.5;

		logTable(fx, results, rank, mrr);

		try {
			assert.ok(mrr >= minMrr, `MRR ${mrr} < minimum ${minMrr}`);
			console.log(`✔ PASS: ${fx.name}`);
			passed++;
		} catch (err) {
			console.error(`✘ FAIL: ${fx.name} — ${(err as Error).message}`);
			failed++;
		}
	}

	// Summary
	console.log(
		`\n=== Summary: ${passed} passed, ${failed} failed out of ${fixtures.length} ===\n`,
	);

	const exitCode = failed > 0 ? 1 : 0;

	// Dispose ONNX sessions and close DB before exiting.
	// Without this, process.exit() triggers ONNX Runtime's global destructors
	// which throw because the logging manager is already torn down (SIGABRT / exit 134).
	// Add timeout to prevent CI hangs if cleanup stalls.
	const cleanupTimeout = setTimeout(() => {
		console.error("Cleanup timed out after 10s, forcing exit");
		process.exit(exitCode);
	}, 10_000);
	cleanupTimeout.unref();

	await embedder.dispose();
	await testDb.$client.close();

	process.exit(exitCode);
}

main().catch((err) => {
	console.error("Bench failed:", err);
	process.exit(1);
});
