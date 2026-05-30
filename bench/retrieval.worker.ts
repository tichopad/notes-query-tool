import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parentPort } from "node:worker_threads";
import { DbLoadRepository } from "../src/commands/load/load-repository.ts";
import { processLoadedFile } from "../src/commands/load/process-file.ts";
import { DbBaseRepository } from "../src/database/base-repository.ts";
import { createDbClient, type DbClient } from "../src/database/client.ts";
import { runMigrations } from "../src/database/migrate.ts";
import { type Embedder, initEmbedder } from "../src/embedder.ts";
import { chunkMarkdown } from "../src/files/chunker.ts";
import { loadFilesByGlob } from "../src/files/load-files.ts";
import { executeQuery, type QueryResult } from "../src/query/execute.ts";

let embedder: Embedder;
let testDb: DbClient;
let defaultBaseId: number;

async function setup() {
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
}

async function runQuery(fixture: {
	vectorQuery: string;
	ftsQuery: string;
}): Promise<QueryResult[]> {
	return await executeQuery({
		vectorText: fixture.vectorQuery,
		queryText: fixture.ftsQuery,
		embedQuery: embedder.embedQuery.bind(embedder),
		db: testDb,
		topK: 10,
		baseId: defaultBaseId,
	});
}

type WorkerMessage =
	| { type: "setup" }
	| { type: "query"; fixture: { vectorQuery: string; ftsQuery: string } }
	| { type: "cleanup" };

if (parentPort) {
	const port = parentPort;
	port.on("message", async (msg: WorkerMessage) => {
		if (msg.type === "setup") {
			await setup();
			port.postMessage({ type: "ready" });
		} else if (msg.type === "query" && msg.fixture) {
			const results = await runQuery(msg.fixture);
			port.postMessage({ type: "results", results });
		} else if (msg.type === "cleanup") {
			if (embedder) {
				await embedder.dispose();
			}
			if (testDb) {
				await testDb.$client.close();
			}
			port.postMessage({ type: "cleaned" });
			process.exit(0);
		}
	});
}
