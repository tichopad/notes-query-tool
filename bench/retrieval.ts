import assert from "node:assert/strict";
import { spawn } from "node:child_process";
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

	if (exitCode === 0) {
		console.log("BENCH_SUCCESS");
		// Keep alive so parent can kill us without triggering native destructors
		setInterval(() => {}, 10_000);
	} else {
		process.exit(exitCode);
	}
}

if (!process.env.BENCH_CHILD) {
	// Wrapper to run benchmark in a child process.
	// onnxruntime-node CPU backend deadlocks in worker_threads, and hangs on process.exit()
	// in the main thread due to C++ global destructors. The child process sidesteps both.
	const child = spawn(
		process.execPath,
		["--no-warnings", ...process.execArgv, import.meta.filename],
		{
			env: { ...process.env, BENCH_CHILD: "1" },
			stdio: ["inherit", "pipe", "inherit"],
		},
	);

	let success = false;
	child.stdout.on("data", (data) => {
		process.stdout.write(data);
		if (data.toString().includes("BENCH_SUCCESS")) {
			success = true;
			child.kill("SIGKILL");
			process.exit(0);
		}
	});

	child.on("exit", (code) => {
		if (!success) {
			process.exit(code ?? 1);
		}
	});
} else {
	main().catch((err) => {
		console.error("Bench failed:", err);
		process.exit(1);
	});
}
