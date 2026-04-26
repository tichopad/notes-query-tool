import { cosineDistance, desc, eq, gt, sql } from "drizzle-orm";
import { db } from "../database/client";
import { chunksTable } from "../database/schema/chunks";
import { filesTable } from "../database/schema/files";

const VECTOR_WEIGHT = 0.3;
const VECTOR_LIMIT = 30;
const FTS_WEIGHT = 0.4;
const FTS_LIMIT = 20;
const TRIGRAM_WEIGHT = 0.3;
const TRIGRAM_THRESHOLD = 0.3;
const TRIGRAM_LIMIT = 20;

export type QueryResult = {
	id: number;
	filePath: string;
	chunkIndex: number;
	breadcrumbs: string[];
	content: string;
	score: number;
};

export type ExecuteQueryOpts = {
	queryText: string;
	embedder: (text: string) => Promise<number[]>;
	weights?: { vector: number; fts: number; trigram: number };
	limits?: { vector: number; fts: number; trigram: number };
	trigramThreshold?: number;
	trigramMode?: "strict" | "word";
	topK?: number;
};

export async function executeQuery(
	opts: ExecuteQueryOpts,
): Promise<QueryResult[]> {
	const {
		queryText,
		embedder,
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

	const queryVector = await embedder(queryText);

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

	const maxSimilarity = Math.max(
		...vectorResults.map((r) => r.similarity),
		1e-9,
	);
	const maxRank = Math.max(...ftsResults.map((r) => r.rank), 1e-9);
	const maxTrigram = Math.max(...trigramResults.map((r) => r.score), 1e-9);

	const merged = new Map<number, QueryResult>();

	for (const r of vectorResults) {
		merged.set(r.id, {
			...r,
			score: (r.similarity / maxSimilarity) * weights.vector,
		});
	}

	for (const r of ftsResults) {
		const ftsScore = (r.rank / maxRank) * weights.fts;
		const existing = merged.get(r.id);
		if (existing) {
			existing.score += ftsScore;
		} else {
			merged.set(r.id, { ...r, score: ftsScore });
		}
	}

	for (const r of trigramResults) {
		const tgScore = (r.score / maxTrigram) * weights.trigram;
		const existing = merged.get(r.id);
		if (existing) {
			existing.score += tgScore;
		} else {
			merged.set(r.id, { ...r, score: tgScore });
		}
	}

	return [...merged.values()].sort((a, b) => b.score - a.score).slice(0, topK);
}
