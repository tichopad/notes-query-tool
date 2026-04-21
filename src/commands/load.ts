import { defineCommand } from "citty";
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
		let filesSeen = 0;
		let filesSkipped = 0;
		let filesProcessed = 0;
		let chunksProduced = 0;

		const repo = new DbLoadRepository();

		let embedFn: ((text: string) => Promise<number[]>) | null = null;
		const getEmbed = async (text: string): Promise<number[]> => {
			if (!embedFn) {
				const { initEmbedder } = await import("../embedder");
				embedFn = await initEmbedder();
			}
			return embedFn(text);
		};

		for await (const filePath of loadFilesByGlob(args.glob)) {
			filesSeen++;

			const result = await processLoadedFile(filePath, {
				repo,
				readText: (p) => Bun.file(p).text(),
				hashContent: (content) =>
					new Bun.CryptoHasher("sha256").update(content).digest("hex"),
				chunkMarkdown,
				embed: getEmbed,
				log: console.log,
			});

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
	},
});
