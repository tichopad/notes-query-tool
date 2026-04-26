import path from "node:path";
import { cosineDistance, desc, eq, gt, sql } from "drizzle-orm";
import { db } from "../database/client.ts";
import { chunksTable } from "../database/schema/chunks.ts";
import { filesTable } from "../database/schema/files.ts";

const VECTOR_WEIGHT = 0.3;
const VECTOR_LIMIT = 30;
const FTS_WEIGHT = 0.4;
const FTS_LIMIT = 20;
const TRIGRAM_WEIGHT = 0.3;
const TRIGRAM_THRESHOLD = 0.3;
const TRIGRAM_LIMIT = 20;

const LINK_BOOST = 0.2;
const LINK_BOOST_CAP = 0.4;
const LINK_SOURCE_TOP_N = 10;

function extractWikilinks(content: string): string[] {
	const re = /\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g;
	const seen = new Set<string>();
	let m: RegExpExecArray | null = re.exec(content);
	while (m !== null) {
		if (m[1] !== undefined) seen.add(m[1].trim());
		m = re.exec(content);
	}
	return [...seen];
}

export type QueryResult = {
	id: number;
	filePath: string;
	chunkIndex: number;
	breadcrumbs: string[];
	content: string;
	score: number;
};

export type ExecuteQueryOpts = {
	vectorText: string;
	queryText: string;
	embedQuery: (text: string) => Promise<number[]>;
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
		vectorText,
		queryText,
		embedQuery,
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

	// Wikilink-aware re-ranking: boost files referenced by top source chunks
	const allFiles = await db
		.select({ id: filesTable.id, filePath: filesTable.filePath })
		.from(filesTable);
	const basenameToFilePaths = new Map<string, Set<string>>();
	for (const f of allFiles) {
		const base = path.basename(f.filePath, ".md");
		if (!basenameToFilePaths.has(base)) {
			basenameToFilePaths.set(base, new Set());
		}
		basenameToFilePaths.get(base)?.add(f.filePath);
	}

	const filePathsInResults = new Set<string>(
		[...merged.values()].map((r) => r.filePath),
	);

	const topSources = [...merged.values()]
		.sort((a, b) => b.score - a.score)
		.slice(0, LINK_SOURCE_TOP_N);

	const boosts = new Map<string, number>();
	for (const src of topSources) {
		const links = extractWikilinks(src.content);
		for (const link of links) {
			const targets = basenameToFilePaths.get(link);
			if (!targets) continue;
			for (const fp of targets) {
				if (fp === src.filePath) continue;
				if (!filePathsInResults.has(fp)) continue;
				const prev = boosts.get(fp) ?? 0;
				boosts.set(fp, Math.min(prev + LINK_BOOST * src.score, LINK_BOOST_CAP));
			}
		}
	}

	for (const chunk of merged.values()) {
		const boost = boosts.get(chunk.filePath);
		if (boost) chunk.score += boost;
	}

	// Per-file max-pool: keep best chunk per file, small bonus for breadth
	const byFile = new Map<
		string,
		{ result: QueryResult; extraChunks: number }
	>();
	for (const result of merged.values()) {
		const existing = byFile.get(result.filePath);
		if (!existing || result.score > existing.result.score) {
			byFile.set(result.filePath, {
				result,
				extraChunks: existing ? existing.extraChunks + 1 : 0,
			});
		} else {
			existing.extraChunks++;
		}
	}

	return [...byFile.values()]
		.map(({ result }) => result)
		.sort((a, b) => b.score - a.score)
		.slice(0, topK);
}
