import { defineCommand } from "citty";
import { eq, sql } from "drizzle-orm";
import { db } from "../database/client";
import { chunksTable } from "../database/schema/chunks";
import { filesTable } from "../database/schema/files";
import { chunkMarkdown } from "../files/chunker";
import { extractFrontmatter } from "../files/frontmatter";
import { loadFilesByGlob } from "../files/load-files";

// Qwen3-Embedding-0.6B: 32k token context.
// ~4 chars/token, reserve ~500 tokens for filepath+breadcrumbs prefix.
// Use 8000 chars per chunk for good retrieval quality with headroom.
const CHUNK_CHAR_LIMIT = 8000;

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
		let fileCount = 0;
		let chunkCount = 0;

		for await (const filePath of loadFilesByGlob(args.glob)) {
			const content = await Bun.file(filePath).text();
			const { attributes, body } = extractFrontmatter(content);
			const contentHash = new Bun.CryptoHasher("sha256")
				.update(content)
				.digest("hex");
			const chunks = chunkMarkdown(body, CHUNK_CHAR_LIMIT);

			// Sort chunks by startOffset to determine chunk_index
			const sorted = chunks
				.map((c, i) => ({ ...c, originalIndex: i }))
				.sort((a, b) => a.startOffset - b.startOffset);

			await db.transaction(async (tx) => {
				const [file] = await tx
					.insert(filesTable)
					.values({ filePath, contentHash, attributes })
					.onConflictDoUpdate({
						target: filesTable.filePath,
						set: {
							contentHash,
							attributes,
							updatedAt: sql`now()`,
						},
					})
					.returning({ id: filesTable.id });

				if (!file) {
					throw new Error(`Failed to upsert file: ${filePath}`);
				}

				// Delete old chunks before re-inserting
				await tx.delete(chunksTable).where(eq(chunksTable.fileId, file.id));

				if (sorted.length > 0) {
					await tx.insert(chunksTable).values(
						sorted.map((chunk, index) => ({
							fileId: file.id,
							chunkIndex: index,
							content: chunk.text,
							breadcrumbs: chunk.breadcrumb,
						})),
					);
				}
			});

			fileCount++;
			chunkCount += sorted.length;
			console.log(`${filePath} → ${sorted.length} chunks`);
		}

		console.log(`Done. ${fileCount} files, ${chunkCount} chunks total.`);
	},
});
