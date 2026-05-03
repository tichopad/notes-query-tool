import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { FtsHit, TrigramHit, VectorHit } from "./scoring.ts";
import { fuseScores, poolByFile, rerankByWikilinks } from "./scoring.ts";

function makeVectorHit(
	id: number,
	filePath: string,
	similarity: number,
	content = "",
): VectorHit {
	return { id, filePath, chunkIndex: 0, breadcrumbs: [], content, similarity };
}

function makeFtsHit(
	id: number,
	filePath: string,
	rank: number,
	content = "",
): FtsHit {
	return { id, filePath, chunkIndex: 0, breadcrumbs: [], content, rank };
}

function makeTrigramHit(
	id: number,
	filePath: string,
	score: number,
	content = "",
): TrigramHit {
	return { id, filePath, chunkIndex: 0, breadcrumbs: [], content, score };
}

describe("fuseScores", () => {
	test("normalises and weights vector-only results", () => {
		const v = [makeVectorHit(1, "a.md", 0.8), makeVectorHit(2, "b.md", 0.4)];
		const merged = fuseScores(v, [], [], {
			vector: 1,
			fts: 0,
			trigram: 0,
		});
		assert.equal(merged.size, 2);
		// id=1 has max similarity so score = 1.0 * weight(1) = 1.0
		assert.equal(merged.get(1)?.score, 1);
		// id=2 is half: 0.4/0.8 = 0.5
		assert.equal(merged.get(2)?.score, 0.5);
	});

	test("accumulates scores for hits appearing in multiple lists", () => {
		const v = [makeVectorHit(1, "a.md", 1)];
		const f = [makeFtsHit(1, "a.md", 1)];
		const merged = fuseScores(v, f, [], { vector: 0.5, fts: 0.5, trigram: 0 });
		// both normalised to 1.0, weight 0.5 each → 1.0
		assert.equal(merged.get(1)?.score, 1.0);
	});

	test("fts-only hit added with correct score", () => {
		const f = [makeFtsHit(99, "x.md", 2)];
		const merged = fuseScores([], f, [], { vector: 0, fts: 0.7, trigram: 0 });
		assert.equal(merged.get(99)?.score, 0.7);
	});

	test("trigram-only hit added with correct score", () => {
		const t = [makeTrigramHit(5, "y.md", 0.9)];
		const merged = fuseScores([], [], t, { vector: 0, fts: 0, trigram: 0.3 });
		assert.equal(merged.get(5)?.score, 0.3);
	});

	test("empty inputs return empty map", () => {
		const merged = fuseScores([], [], [], { vector: 1, fts: 1, trigram: 1 });
		assert.equal(merged.size, 0);
	});
});

describe("rerankByWikilinks", () => {
	test("boosts target file referenced by top source", () => {
		// src chunk links to target.md
		const v = [
			makeVectorHit(1, "src.md", 1, "See [[target]]"),
			makeVectorHit(2, "target.md", 0.1),
		];
		const merged = fuseScores(v, [], [], { vector: 1, fts: 0, trigram: 0 });

		const reranked = rerankByWikilinks(
			merged,
			["src.md", "target.md"],
			5,
			0.1,
			10,
		);

		assert.equal(merged.get(2)?.score, 0.1);
		assert.equal(reranked.get(2)?.score, 0.2);
	});

	test("does not mutate the input map", () => {
		const v = [
			makeVectorHit(1, "src.md", 1, "See [[target]]"),
			makeVectorHit(2, "target.md", 0.1),
		];
		const merged = fuseScores(v, [], [], { vector: 1, fts: 0, trigram: 0 });
		const scoreBefore = merged.get(2)?.score ?? 0;

		rerankByWikilinks(merged, ["src.md", "target.md"], 5, 0.1, 10);

		assert.equal(
			merged.get(2)?.score,
			scoreBefore,
			"input map must not be mutated",
		);
	});

	test("does not boost self-links", () => {
		const v = [makeVectorHit(1, "src.md", 1, "See [[src]]")];
		const merged = fuseScores(v, [], [], { vector: 1, fts: 0, trigram: 0 });
		const before = merged.get(1)?.score ?? 0;

		const reranked = rerankByWikilinks(merged, ["src.md"], 5, 0.1, 10);

		assert.equal(reranked.get(1)?.score, before);
	});

	test("respects linkBoostCap", () => {
		const v = [
			makeVectorHit(1, "src-a.md", 1, "[[target]]"),
			makeVectorHit(2, "src-b.md", 0.9, "[[target]]"),
			makeVectorHit(3, "target.md", 0),
		];
		const merged = fuseScores(v, [], [], { vector: 1, fts: 0, trigram: 0 });
		const reranked = rerankByWikilinks(
			merged,
			["src-a.md", "src-b.md", "target.md"],
			5,
			0.3,
			0.5,
		);
		const target = reranked.get(3);
		assert.equal(target?.score, 0.5);
	});

	test("only topN source chunks contribute boosts", () => {
		const v = [
			makeVectorHit(1, "src-a.md", 1, "[[target]]"),
			makeVectorHit(2, "src-b.md", 0.8, "[[target]]"),
			makeVectorHit(3, "target.md", 0.2),
		];
		const merged = fuseScores(v, [], [], { vector: 1, fts: 0, trigram: 0 });

		const reranked = rerankByWikilinks(
			merged,
			["src-a.md", "src-b.md", "target.md"],
			1,
			0.5,
			10,
		);

		assert.equal(reranked.get(3)?.score, 0.7);
	});

	test("boosts all result files sharing linked basename", () => {
		const v = [
			makeVectorHit(1, "src.md", 1, "[[target]]"),
			makeVectorHit(2, "notes/target.md", 0.3),
			makeVectorHit(3, "archive/target.md", 0.2),
		];
		const merged = fuseScores(v, [], [], { vector: 1, fts: 0, trigram: 0 });

		const reranked = rerankByWikilinks(
			merged,
			["src.md", "notes/target.md", "archive/target.md"],
			5,
			0.4,
			10,
		);

		assert.equal(reranked.get(2)?.score, 0.7);
		assert.equal(reranked.get(3)?.score, 0.6000000000000001);
	});
});

describe("poolByFile", () => {
	test("keeps best chunk per file", () => {
		const v = [
			makeVectorHit(1, "a.md", 0.9),
			makeVectorHit(2, "a.md", 0.4),
			makeVectorHit(3, "b.md", 0.6),
		];
		const merged = fuseScores(v, [], [], { vector: 1, fts: 0, trigram: 0 });
		const results = poolByFile(merged, 10);
		assert.equal(results.length, 2);
		const aResult = results.find((r) => r.filePath === "a.md");
		assert.equal(aResult?.id, 1); // highest score chunk
	});

	test("honours topK limit", () => {
		const v = [
			makeVectorHit(1, "a.md", 0.9),
			makeVectorHit(2, "b.md", 0.8),
			makeVectorHit(3, "c.md", 0.7),
		];
		const merged = fuseScores(v, [], [], { vector: 1, fts: 0, trigram: 0 });
		const results = poolByFile(merged, 2);
		assert.deepEqual(
			results.map((result) => ({
				id: result.id,
				filePath: result.filePath,
				score: result.score,
			})),
			[
				{ id: 1, filePath: "a.md", score: 1 },
				{ id: 2, filePath: "b.md", score: 0.888888888888889 },
			],
		);
	});

	test("returns sorted by score descending", () => {
		const v = [
			makeVectorHit(1, "a.md", 0.3),
			makeVectorHit(2, "b.md", 0.9),
			makeVectorHit(3, "c.md", 0.6),
		];
		const merged = fuseScores(v, [], [], { vector: 1, fts: 0, trigram: 0 });
		const results = poolByFile(merged, 10);
		assert.deepEqual(
			results.map((result) => ({
				id: result.id,
				filePath: result.filePath,
				score: result.score,
			})),
			[
				{ id: 2, filePath: "b.md", score: 1 },
				{ id: 3, filePath: "c.md", score: 0.6666666666666666 },
				{ id: 1, filePath: "a.md", score: 0.3333333333333333 },
			],
		);
	});
});
