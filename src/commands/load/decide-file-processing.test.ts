import { expect, test } from "bun:test";
import { decideFileProcessing } from "./decide-file-processing.ts";

test("null existing state → process", () => {
	expect(decideFileProcessing("abc123", null)).toEqual({ action: "process" });
});

test("hash changed → process", () => {
	expect(
		decideFileProcessing("newHash", {
			contentHash: "oldHash",
			hasStoredChunksWithEmbeddings: true,
		}),
	).toEqual({ action: "process" });
});

test("same hash + chunks with embeddings → skip", () => {
	expect(
		decideFileProcessing("abc123", {
			contentHash: "abc123",
			hasStoredChunksWithEmbeddings: true,
		}),
	).toEqual({ action: "skip" });
});

test("same hash + no chunks/embeddings → process", () => {
	expect(
		decideFileProcessing("abc123", {
			contentHash: "abc123",
			hasStoredChunksWithEmbeddings: false,
		}),
	).toEqual({ action: "process" });
});
