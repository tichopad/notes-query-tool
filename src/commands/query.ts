import { defineCommand } from "citty";
import { cosineDistance, desc, eq, gt, sql } from "drizzle-orm";
import { db } from "../database/client";
import { chunksTable } from "../database/schema/chunks";
import { filesTable } from "../database/schema/files";
import { EMBEDDING_DIMS, initEmbedder } from "../embedder";

const INSTRUCT_PREFIX =
	"Instruct: Retrieve relevant note chunks that answer the user's query\nQuery: ";

const VECTOR_WEIGHT = 0.4;
const FTS_WEIGHT = 0.6;

export const queryCommand = defineCommand({
	meta: {
		name: "query",
		description: "Search notes by semantic query",
	},
	args: {
		vector: {
			type: "string",
			alias: "vs",
			description: "Semantic query for vector search",
			required: true,
		},
		fulltext: {
			type: "string",
			alias: "fts",
			description: "Keyword query for full-text search",
			required: true,
		},
	},
	async run({ args }) {
		const getEmbedding = await initEmbedder();

		const queryText = INSTRUCT_PREFIX + args.vector;
		const queryVector = await getEmbedding(queryText);

		if (queryVector.length !== EMBEDDING_DIMS) {
			throw new Error(
				`Expected ${EMBEDDING_DIMS}-dim embedding, got ${queryVector.length}`,
			);
		}

		const similarity = sql<number>`1 - (${cosineDistance(chunksTable.embedding, queryVector)})`;

		const [vectorResults, ftsResults] = await Promise.all([
			db
				.select({
					id: chunksTable.id,
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
				.limit(20),

			db
				.select({
					id: chunksTable.id,
					filePath: filesTable.filePath,
					chunkIndex: chunksTable.chunkIndex,
					breadcrumbs: chunksTable.breadcrumbs,
					content: chunksTable.content,
					rank: sql<number>`ts_rank(${chunksTable.fts}, websearch_to_tsquery('simple', unaccent(${args.fulltext})))`,
				})
				.from(chunksTable)
				.innerJoin(filesTable, eq(chunksTable.fileId, filesTable.id))
				.where(
					sql`${chunksTable.fts} @@ websearch_to_tsquery('simple', unaccent(${args.fulltext}))`,
				)
				.orderBy(
					desc(
						sql`ts_rank(${chunksTable.fts}, websearch_to_tsquery('simple', unaccent(${args.fulltext})))`,
					),
				)

				.limit(20),
		]);

		if (vectorResults.length === 0 && ftsResults.length === 0) {
			console.log("No matching chunks found.");
			return;
		}

		console.log("ftsResults", ftsResults);

		const maxSimilarity = Math.max(
			...vectorResults.map((r) => r.similarity),
			1e-9,
		);
		const maxRank = Math.max(...ftsResults.map((r) => r.rank), 1e-9);

		const merged = new Map<
			number,
			{
				id: number;
				filePath: string;
				chunkIndex: number;
				breadcrumbs: string[];
				content: string;
				score: number;
			}
		>();

		for (const r of vectorResults) {
			merged.set(r.id, {
				...r,
				score: (r.similarity / maxSimilarity) * VECTOR_WEIGHT,
			});
		}

		for (const r of ftsResults) {
			const ftsScore = (r.rank / maxRank) * FTS_WEIGHT;
			const existing = merged.get(r.id);
			if (existing) {
				existing.score += ftsScore;
			} else {
				merged.set(r.id, { ...r, score: ftsScore });
			}
		}

		const final = [...merged.values()]
			.sort((a, b) => b.score - a.score)
			.slice(0, 10);

		for (const row of final) {
			const breadcrumb = row.breadcrumbs
				.map((b) => b.replaceAll("#", "").trim())
				.join(" > ");
			const header = breadcrumb
				? `${row.filePath} [${row.chunkIndex}] ${breadcrumb}`
				: `${row.filePath} [${row.chunkIndex}]`;

			console.log(`${header} (score: ${Number(row.score).toFixed(3)})`);
		}

		await Bun.file("query_results.yaml")
			.delete()
			.catch(() => {});
		await Bun.write("query_results.yaml", Bun.YAML.stringify(final, null, 2));
	},
});
