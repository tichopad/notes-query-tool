import assert from "node:assert/strict";
import path from "node:path";
import { after, before, test } from "node:test";
import { Worker } from "node:worker_threads";
import type { QueryResult } from "../src/query/execute.ts";
import { fixtures } from "./fixtures.ts";

let worker: Worker;

function sendAndWait<T>(msg: Record<string, unknown>): Promise<T> {
	return new Promise((resolve, reject) => {
		const onMessage = (data: unknown) => {
			worker.off("message", onMessage);
			worker.off("error", onError);
			resolve(data as T);
		};
		const onError = (err: Error) => {
			worker.off("message", onMessage);
			worker.off("error", onError);
			reject(err);
		};
		worker.on("message", onMessage);
		worker.on("error", onError);
		worker.postMessage(msg);
	});
}

before(async () => {
	worker = new Worker(path.resolve(import.meta.dirname, "retrieval.worker.ts"));
	await sendAndWait({ type: "setup" });
});

after(async () => {
	try {
		await sendAndWait({ type: "cleanup" });
	} catch {
		// Ignore cleanup errors
	}
	await Promise.race([
		worker.terminate(),
		new Promise((resolve) => setTimeout(resolve, 5000)),
	]);
	process.exit(0);
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
		const { results } = await sendAndWait<{ results: QueryResult[] }>({
			type: "query",
			fixture: { vectorQuery: fx.vectorQuery, ftsQuery: fx.ftsQuery },
		});
		const rank = firstRelevantRank(results, fx.expectedFiles);
		const mrr = rank === Infinity ? 0 : 1 / rank;
		logTable(fx, results, rank, mrr);
		const minMrr = fx.minMrr ?? 0.5;
		assert.ok(mrr >= minMrr, `${mrr} >= ${minMrr}`);
	});
}
