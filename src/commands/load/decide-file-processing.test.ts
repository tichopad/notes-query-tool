import assert from "node:assert/strict";
import { test } from "node:test";
import { decideFileProcessing } from "./decide-file-processing.ts";

test("null existing state → process", () => {
	assert.deepEqual(decideFileProcessing("abc123", null), { action: "process" });
});

test("hash changed → process", () => {
	assert.deepEqual(
		decideFileProcessing("newHash", {
			contentHash: "oldHash",
			hasStoredChunksWithEmbeddings: true,
		}),
		{ action: "process" },
	);
});

test("same hash + chunks with embeddings → skip", () => {
	assert.deepEqual(
		decideFileProcessing("abc123", {
			contentHash: "abc123",
			hasStoredChunksWithEmbeddings: true,
		}),
		{ action: "skip" },
	);
});

test("same hash + no chunks/embeddings → process", () => {
	assert.deepEqual(
		decideFileProcessing("abc123", {
			contentHash: "abc123",
			hasStoredChunksWithEmbeddings: false,
		}),
		{ action: "process" },
	);
});
