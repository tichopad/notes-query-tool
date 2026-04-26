import { defineCommand } from "citty";
import { cosineDistance, desc, eq, gt, sql } from "drizzle-orm";
import { db } from "../database/client";
import { chunksTable } from "../database/schema/chunks";
import { filesTable } from "../database/schema/files";
import { EMBEDDING_DIMS, initEmbedder } from "../embedder";

const INSTRUCT_PREFIX =
	"Instruct: Retrieve relevant note chunks that answer the user's query\nQuery: ";

const VECTOR_WEIGHT = 0.3;
const VECTOR_LIMIT = 30;
const FTS_WEIGHT = 0.4;
const FTS_LIMIT = 20;
const TRIGRAM_WEIGHT = 0.3;
const TRIGRAM_THRESHOLD = 0.3;
const TRIGRAM_LIMIT = 20;

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
		trigramMode: {
			type: "string",
			alias: "tg",
			description:
				"Trigram operator: 'strict' (strict_word_similarity, <<%) or 'word' (word_similarity, <%)",
			default: "strict",
		},
	},
	async run({ args }) {
		const mode = args.trigramMode;
		if (mode !== "strict" && mode !== "word") {
			throw new Error(
				`Invalid --trigram-mode "${mode}". Must be "strict" or "word".`,
			);
		}

		const getEmbedding = await initEmbedder();

		const queryText = INSTRUCT_PREFIX + args.vector;
		const queryVector = await getEmbedding(queryText);

		if (queryVector.length !== EMBEDDING_DIMS) {
			throw new Error(
				`Expected ${EMBEDDING_DIMS}-dim embedding, got ${queryVector.length}`,
			);
		}

		const similarity = sql<number>`1 - (${cosineDistance(chunksTable.embedding, queryVector)})`;

		const trigramFn =
			mode === "strict" ? "strict_word_similarity" : "word_similarity";
		const trigramOp = mode === "strict" ? sql.raw("<<%") : sql.raw("<%");
		const trigramScore = sql<number>`${sql.raw(trigramFn)}(${args.fulltext}, ${chunksTable.content})`;

		const [vectorResults, ftsResults, trigramResults] = await Promise.all([
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
				.limit(VECTOR_LIMIT),

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
				.limit(FTS_LIMIT),

			db.transaction(async (tx) => {
				await tx.execute(sql`SELECT set_limit(${TRIGRAM_THRESHOLD})`);
				return tx
					.select({
						id: chunksTable.id,
						filePath: filesTable.filePath,
						chunkIndex: chunksTable.chunkIndex,
						breadcrumbs: chunksTable.breadcrumbs,
						content: chunksTable.content,
						score: trigramScore,
					})
					.from(chunksTable)
					.innerJoin(filesTable, eq(chunksTable.fileId, filesTable.id))
					.where(sql`${args.fulltext} ${trigramOp} ${chunksTable.content}`)
					.orderBy(desc(trigramScore))
					.limit(TRIGRAM_LIMIT);
			}),
		]);

		if (
			vectorResults.length === 0 &&
			ftsResults.length === 0 &&
			trigramResults.length === 0
		) {
			console.log("No matching chunks found.");
			return;
		}

		console.log(
			`channels: vector=${vectorResults.length} fts=${ftsResults.length} trigram=${trigramResults.length} (${mode})`,
		);

		const maxSimilarity = Math.max(
			...vectorResults.map((r) => r.similarity),
			1e-9,
		);
		const maxRank = Math.max(...ftsResults.map((r) => r.rank), 1e-9);
		const maxTrigram = Math.max(...trigramResults.map((r) => r.score), 1e-9);

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

		console.log("vector results:");
		for (const r of vectorResults) {
			console.log(
				`  ${r.filePath} [${r.chunkIndex}] similarity=${Number(
					r.similarity,
				).toFixed(3)}`,
			);
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

		console.log("full-text results:");
		for (const r of ftsResults) {
			console.log(
				`  ${r.filePath} [${r.chunkIndex}] rank=${Number(r.rank).toFixed(3)}`,
			);
		}

		for (const r of trigramResults) {
			const tgScore = (r.score / maxTrigram) * TRIGRAM_WEIGHT;
			const existing = merged.get(r.id);
			if (existing) {
				existing.score += tgScore;
			} else {
				merged.set(r.id, { ...r, score: tgScore });
			}
		}

		console.log("trigram results (pre-merge):");
		for (const r of trigramResults) {
			console.log(
				`  ${r.filePath} [${r.chunkIndex}] score=${Number(r.score).toFixed(3)}`,
			);
		}

		const final = [...merged.values()]
			.sort((a, b) => b.score - a.score)
			.slice(0, 10);

		console.log("\nFinal merged results:");
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
