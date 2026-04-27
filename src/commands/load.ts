import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { defineCommand } from "citty";
import { type Embedder, initEmbedder } from "../embedder.ts";
import { chunkMarkdown } from "../files/chunker.ts";
import { loadFilesByGlob } from "../files/load-files.ts";
import { DbLoadRepository } from "./load/load-repository.ts";
import { type FileLoadResult, processLoadedFile } from "./load/process-file.ts";

export const loadCommand = defineCommand({
	meta: {
		name: "load",
		description: "Load notes files",
	},
	args: {
		glob: {
			type: "string",
			description: "Files glob (e.g. 'notes/**/*.md')",
			required: true,
		},
	},
	async run({ args }) {
		const start = performance.now();

		let filesSeen = 0;
		let filesSkipped = 0;
		let filesProcessed = 0;
		let chunksProduced = 0;

		const repo = new DbLoadRepository();

		let embedder: Embedder | null = null;
		const getEmbedDocument = async (
			body: string,
			title?: string | null,
		): Promise<number[]> => {
			if (!embedder) {
				embedder = await initEmbedder();
			}
			return embedder.embedDocument(body, title);
		};

		const filePaths: string[] = [];
		const results: FileLoadResult[] = [];

		for await (const filePath of loadFilesByGlob(args.glob)) {
			const result = await processLoadedFile(filePath, {
				repo,
				readText: (p) => readFile(p, "utf8"),
				hashContent: (content) =>
					createHash("sha256").update(content).digest("hex"),
				chunkMarkdown,
				embedDocument: getEmbedDocument,
				log: console.log,
			});
			filePaths.push(filePath);
			results.push(result);
		}

		filesSeen = filePaths.length;

		for (const result of results) {
			if (result.status === "skipped") {
				filesSkipped++;
			} else {
				filesProcessed++;
				chunksProduced += result.chunkCount;
			}
		}

		console.log(
			`Done. ${filesSeen} files seen, ${filesProcessed} processed, ${filesSkipped} skipped, ${chunksProduced} chunks total.`,
		);
		console.log(
			`Time taken: ${((performance.now() - start) / 1000).toFixed(2)}s`,
		);
	},
});
