import { defineCommand } from "citty";
import pLimit from "p-limit";
import { initEmbedder } from "../embedder";
import { chunkMarkdown } from "../files/chunker";
import { loadFilesByGlob } from "../files/load-files";
import { DbLoadRepository } from "./load/load-repository";
import { processLoadedFile } from "./load/process-file";

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

		let embedFn: ((text: string) => Promise<number[]>) | null = null;
		const getEmbed = async (text: string): Promise<number[]> => {
			if (!embedFn) {
				embedFn = await initEmbedder();
			}
			return embedFn(text);
		};

		const limit = pLimit(2);

		const filePaths = await Array.fromAsync(loadFilesByGlob(args.glob));
		filesSeen = filePaths.length;

		const results = await Promise.all(
			filePaths.map((filePath) =>
				limit(() =>
					processLoadedFile(filePath, {
						repo,
						readText: (p) => Bun.file(p).text(),
						hashContent: (content) =>
							new Bun.CryptoHasher("sha256").update(content).digest("hex"),
						chunkMarkdown,
						embed: getEmbed,
						log: console.log,
					}),
				),
			),
		);

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
