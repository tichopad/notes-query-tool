import path from "node:path";
import { LINK_BOOST, LINK_BOOST_CAP, LINK_SOURCE_TOP_N } from "../config.ts";
import type { QueryResult } from "./execute.ts";

export type RawHit = {
	id: number;
	filePath: string;
	chunkIndex: number;
	breadcrumbs: string[];
	content: string;
};

export type VectorHit = RawHit & { similarity: number };
export type FtsHit = RawHit & { rank: number };
export type TrigramHit = RawHit & { score: number };

export type FuseWeights = { vector: number; fts: number; trigram: number };

/**
 * Pure: merge three ranked lists into a single scored map.
 * Normalises each list to [0,1] then applies weights.
 */
export function fuseScores(
	vectorResults: VectorHit[],
	ftsResults: FtsHit[],
	trigramResults: TrigramHit[],
	weights: FuseWeights,
): Map<number, QueryResult> {
	const maxSimilarity = Math.max(
		...vectorResults.map((r) => r.similarity),
		1e-9,
	);
	const maxRank = Math.max(...ftsResults.map((r) => r.rank), 1e-9);
	const maxTrigram = Math.max(...trigramResults.map((r) => r.score), 1e-9);

	const merged = new Map<number, QueryResult>();

	for (const r of vectorResults) {
		merged.set(r.id, {
			id: r.id,
			filePath: r.filePath,
			chunkIndex: r.chunkIndex,
			breadcrumbs: r.breadcrumbs,
			content: r.content,
			score: (r.similarity / maxSimilarity) * weights.vector,
		});
	}

	for (const r of ftsResults) {
		const ftsScore = (r.rank / maxRank) * weights.fts;
		const existing = merged.get(r.id);
		if (existing) {
			existing.score += ftsScore;
		} else {
			merged.set(r.id, {
				id: r.id,
				filePath: r.filePath,
				chunkIndex: r.chunkIndex,
				breadcrumbs: r.breadcrumbs,
				content: r.content,
				score: ftsScore,
			});
		}
	}

	for (const r of trigramResults) {
		const tgScore = (r.score / maxTrigram) * weights.trigram;
		const existing = merged.get(r.id);
		if (existing) {
			existing.score += tgScore;
		} else {
			merged.set(r.id, {
				id: r.id,
				filePath: r.filePath,
				chunkIndex: r.chunkIndex,
				breadcrumbs: r.breadcrumbs,
				content: r.content,
				score: tgScore,
			});
		}
	}

	return merged;
}

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

/**
 * Pure: return a new map with boosted scores for files referenced by top-N
 * source chunks via wikilinks. Does not mutate the input map.
 */
export function rerankByWikilinks(
	merged: Map<number, QueryResult>,
	allFilePaths: string[],
	topN: number = LINK_SOURCE_TOP_N,
	linkBoost: number = LINK_BOOST,
	linkBoostCap: number = LINK_BOOST_CAP,
): Map<number, QueryResult> {
	const basenameToFilePaths = new Map<string, Set<string>>();
	for (const fp of allFilePaths) {
		const base = path.basename(fp, ".md");
		if (!basenameToFilePaths.has(base)) {
			basenameToFilePaths.set(base, new Set());
		}
		basenameToFilePaths.get(base)?.add(fp);
	}

	const filePathsInResults = new Set<string>(
		[...merged.values()].map((r) => r.filePath),
	);

	const topSources = [...merged.values()]
		.sort((a, b) => b.score - a.score)
		.slice(0, topN);

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
				boosts.set(fp, Math.min(prev + linkBoost * src.score, linkBoostCap));
			}
		}
	}

	const result = new Map<number, QueryResult>();
	for (const [id, chunk] of merged) {
		const boost = boosts.get(chunk.filePath) ?? 0;
		result.set(
			id,
			boost > 0 ? { ...chunk, score: chunk.score + boost } : chunk,
		);
	}
	return result;
}

/**
 * Pure: keep best-scoring chunk per file, return top-K sorted results.
 */
export function poolByFile(
	merged: Map<number, QueryResult>,
	topK: number,
): QueryResult[] {
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
