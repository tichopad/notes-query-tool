import { cosineDistance, desc, eq, gt, sql } from "drizzle-orm";
import {
	FTS_LIMIT,
	FTS_WEIGHT,
	TRIGRAM_LIMIT,
	TRIGRAM_THRESHOLD,
	TRIGRAM_WEIGHT,
	VECTOR_LIMIT,
	VECTOR_WEIGHT,
} from "../config.ts";
import { db as defaultDb, type PgliteDatabase } from "../database/client.ts";
import { chunksTable } from "../database/schema/chunks.ts";
import { filesTable } from "../database/schema/files.ts";
import { fuseScores, poolByFile, rerankByWikilinks } from "./scoring.ts";

/** A single ranked chunk result returned by {@link executeQuery}. */
export type QueryResult = {
	/** Database row ID of the chunk. */
	id: number;
	/** Relative file path of the note the chunk belongs to. */
	filePath: string;
	/** Zero-based position of this chunk within its file. */
	chunkIndex: number;
	/** Ordered list of heading ancestors that provide context for the chunk. */
	breadcrumbs: string[];
	/** Raw markdown text of the chunk. */
	content: string;
	/** Final fused relevance score after reranking (higher is better). */
	score: number;
};

/**
 * Options accepted by {@link executeQuery}.
 */
export type ExecuteQueryOpts = {
	/** Text to embed for the vector similarity search leg. */
	vectorText: string;
	/** Raw query string used for FTS and trigram search legs. */
	queryText: string;
	/** Function that converts a string into a dense embedding vector. */
	embedQuery: (text: string) => Promise<number[]>;
	/** Database instance to query; defaults to the shared PGLite client. */
	db?: PgliteDatabase;
	/** Per-leg score weights used when fusing results. */
	weights?: { vector: number; fts: number; trigram: number };
	/** Maximum number of candidate rows fetched from each search leg. */
	limits?: { vector: number; fts: number; trigram: number };
	/** Minimum trigram similarity threshold (passed to `set_limit`). */
	trigramThreshold?: number;
	/** Trigram operator variant: `"strict"` uses `<<%`, `"word"` uses `<%`. */
	trigramMode?: "strict" | "word";
	/** Maximum number of results to return after pooling by file. */
	topK?: number;
};

/**
 * Execute a hybrid search query against the notes database.
 *
 * Runs three search legs in parallel — vector similarity, full-text search
 * (FTS), and trigram matching — then fuses their scores, reranks by wikilink
 * connectivity, and pools the top results by source file.
 *
 * @returns Ranked list of {@link QueryResult} chunks, at most `topK` entries.
 */
export async function executeQuery(
	opts: ExecuteQueryOpts,
): Promise<QueryResult[]> {
	const {
		vectorText,
		queryText,
		embedQuery,
		db = defaultDb,
		weights = {
			vector: VECTOR_WEIGHT,
			fts: FTS_WEIGHT,
			trigram: TRIGRAM_WEIGHT,
		},
		limits = {
			vector: VECTOR_LIMIT,
			fts: FTS_LIMIT,
			trigram: TRIGRAM_LIMIT,
		},
		trigramThreshold = TRIGRAM_THRESHOLD,
		trigramMode = "strict",
		topK = 10,
	} = opts;

	const queryVector = await embedQuery(vectorText);

	const similarity = sql<number>`1 - (${cosineDistance(chunksTable.embedding, queryVector)})`;

	const trigramFn =
		trigramMode === "strict" ? "strict_word_similarity" : "word_similarity";
	const trigramOp = trigramMode === "strict" ? sql.raw("<<%") : sql.raw("<%");
	const trigramScore = sql<number>`${sql.raw(trigramFn)}(${queryText}, ${chunksTable.content})`;

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
			.limit(limits.vector),

		db
			.select({
				id: chunksTable.id,
				filePath: filesTable.filePath,
				chunkIndex: chunksTable.chunkIndex,
				breadcrumbs: chunksTable.breadcrumbs,
				content: chunksTable.content,
				rank: sql<number>`ts_rank(${chunksTable.fts}, websearch_to_tsquery('simple', unaccent(${queryText})))`,
			})
			.from(chunksTable)
			.innerJoin(filesTable, eq(chunksTable.fileId, filesTable.id))
			.where(
				sql`${chunksTable.fts} @@ websearch_to_tsquery('simple', unaccent(${queryText}))`,
			)
			.orderBy(
				desc(
					sql`ts_rank(${chunksTable.fts}, websearch_to_tsquery('simple', unaccent(${queryText})))`,
				),
			)
			.limit(limits.fts),

		db.transaction(async (tx) => {
			await tx.execute(sql`SELECT set_limit(${trigramThreshold})`);
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
				.where(sql`${queryText} ${trigramOp} ${chunksTable.content}`)
				.orderBy(desc(trigramScore))
				.limit(limits.trigram);
		}),
	]);

	const allFiles = await db
		.select({ filePath: filesTable.filePath })
		.from(filesTable);

	const fused = fuseScores(vectorResults, ftsResults, trigramResults, weights);
	const reranked = rerankByWikilinks(
		fused,
		allFiles.map((f) => f.filePath),
	);
	return poolByFile(reranked, topK);
}
