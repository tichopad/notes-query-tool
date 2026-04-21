import { defineCommand } from "citty";
import { cosineDistance, desc, eq, gt, sql } from "drizzle-orm";
import { db } from "../database/client";
import { chunksTable } from "../database/schema/chunks";
import { filesTable } from "../database/schema/files";
import { EMBEDDING_DIMS, initEmbedder } from "../embedder";

const INSTRUCT_PREFIX =
	"Instruct: Retrieve relevant note chunks that answer the user's query\nQuery: ";

export const queryCommand = defineCommand({
	meta: {
		name: "query",
		description: "Search notes by semantic query",
	},
	args: {
		query: {
			type: "positional",
			description: "Search query text",
			required: true,
		},
	},
	async run({ args }) {
		const getEmbedding = await initEmbedder();

		const queryText = INSTRUCT_PREFIX + args.query;
		const queryVector = await getEmbedding(queryText);

		if (queryVector.length !== EMBEDDING_DIMS) {
			throw new Error(
				`Expected ${EMBEDDING_DIMS}-dim embedding, got ${queryVector.length}`,
			);
		}

		const similarity = sql<number>`1 - (${cosineDistance(chunksTable.embedding, queryVector)})`;

		const results = await db
			.select({
				filePath: filesTable.filePath,
				chunkIndex: chunksTable.chunkIndex,
				breadcrumbs: chunksTable.breadcrumbs,
				content: chunksTable.content,
				similarity,
			})
			.from(chunksTable)
			.innerJoin(filesTable, eq(chunksTable.fileId, filesTable.id))
			.where(gt(similarity, 0))
			.orderBy(desc(similarity))
			.limit(10);

		if (results.length === 0) {
			console.log("No matching chunks found.");
			return;
		}

		const sortedBySimilarity = results.sort(
			(a, b) => b.similarity - a.similarity,
		);

		for (const row of sortedBySimilarity) {
			const breadcrumb = row.breadcrumbs
				.map((b) => b.replaceAll("#", "").trim())
				.join(" > ");
			const header = breadcrumb
				? `${row.filePath} [${row.chunkIndex}] ${breadcrumb}`
				: `${row.filePath} [${row.chunkIndex}]`;

			console.log(`${header} (score: ${Number(row.similarity).toFixed(3)})`);
		}
	},
});
