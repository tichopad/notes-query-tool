import assert from "node:assert/strict";
import { test } from "node:test";
import type { Chunk } from "../../files/chunker.ts";
import type { FileProcessingState, LoadRepository } from "./load-repository.ts";
import { type ProcessFileDeps, processLoadedFile } from "./process-file.ts";

const FAKE_CONTENT = "# Hello\n\nSome content here.";
const FILE_PATH = "notes/test.md";
const MATCHING_HASH = "abc123";
const DIFFERENT_HASH = "def456";
const NEW_FILE_ID = 42;

function makeChunk(text: string): Chunk {
	return { text, breadcrumb: [], startOffset: 0, endOffset: text.length };
}

type ChunkMarkdownCall = { content: string; args: unknown[] };
type UpsertFileCall = {
	filePath: string;
	contentHash: string;
	title: string | null;
	updatedAt: Date;
};
type ReplaceFileChunksCall = {
	fileId: number;
	chunks: Array<{ content: string; embedding: number[]; chunkIndex: number }>;
};

type TrackedDeps = {
	deps: ProcessFileDeps;
	chunkMarkdownCalls: ChunkMarkdownCall[];
	upsertFileCalls: UpsertFileCall[];
	replaceFileChunksCalls: ReplaceFileChunksCall[];
	embedDocumentCalls: string[];
};

type MakeDepsOverrides = {
	state?: FileProcessingState;
	readText?: (filePath: string) => Promise<string>;
	hashContent?: (content: string) => string;
	chunkMarkdown?: (content: string, ...args: unknown[]) => Chunk[];
	embedDocument?: (body: string, title?: string | null) => Promise<number[]>;
	log?: (line: string) => void;
	upsertFileId?: number;
};

function makeDeps(overrides: MakeDepsOverrides = {}): TrackedDeps {
	const chunkMarkdownCalls: ChunkMarkdownCall[] = [];
	const upsertFileCalls: UpsertFileCall[] = [];
	const replaceFileChunksCalls: ReplaceFileChunksCall[] = [];
	const embedDocumentCalls: string[] = [];

	const state = overrides.state ?? null;
	const upsertFileId = overrides.upsertFileId ?? NEW_FILE_ID;

	const repo: LoadRepository = {
		async getFileProcessingState(): Promise<FileProcessingState> {
			return state;
		},
		async upsertFile(filePath, contentHash, title, updatedAt) {
			upsertFileCalls.push({ filePath, contentHash, title, updatedAt });
			return { id: upsertFileId };
		},
		async replaceFileChunks(fileId, chunks) {
			replaceFileChunksCalls.push({ fileId, chunks });
		},
	};

	const chunkMarkdown = overrides.chunkMarkdown ?? (() => [makeChunk("c1")]);
	const embedDocument = overrides.embedDocument ?? (async () => [0.1, 0.2]);

	const deps: ProcessFileDeps = {
		repo,
		readText: overrides.readText ?? (async () => FAKE_CONTENT),
		hashContent: overrides.hashContent ?? (() => MATCHING_HASH),
		chunkMarkdown: (content, ...args) => {
			chunkMarkdownCalls.push({ content, args });
			return chunkMarkdown(content, ...args);
		},
		embedDocument: async (body, title) => {
			embedDocumentCalls.push(body);
			return embedDocument(body, title);
		},
		log: overrides.log ?? (() => {}),
	};

	return {
		deps,
		chunkMarkdownCalls,
		upsertFileCalls,
		replaceFileChunksCalls,
		embedDocumentCalls,
	};
}

test("new file (state=null) → chunks, embeds, upserts, replaces with correct payload", async () => {
	const chunks = [makeChunk("first chunk"), makeChunk("second chunk")];
	const tracked = makeDeps({
		state: null,
		chunkMarkdown: () => chunks,
		embedDocument: async (body) => [body.length, 0],
	});

	const result = await processLoadedFile(FILE_PATH, tracked.deps);

	assert.deepEqual(result, { status: "processed", chunkCount: 2 });

	// chunkMarkdown called once with body (frontmatter stripped) + size 2000
	assert.equal(tracked.chunkMarkdownCalls.length, 1);
	assert.equal(tracked.chunkMarkdownCalls[0]?.content, FAKE_CONTENT); // no frontmatter → body == content
	assert.deepEqual(tracked.chunkMarkdownCalls[0]?.args, [2000]);

	// upsertFile called once with the right args
	assert.equal(tracked.upsertFileCalls.length, 1);
	const upsertCall = tracked.upsertFileCalls[0];
	assert.equal(upsertCall?.filePath, FILE_PATH);
	assert.equal(upsertCall?.contentHash, MATCHING_HASH);
	assert.equal(upsertCall?.title, null);
	assert.ok(upsertCall?.updatedAt instanceof Date, "expected instanceof Date");

	// embedDocument called per chunk with bare chunk text (not augmented)
	const header = "File: test\nPath: notes";
	assert.deepEqual(tracked.embedDocumentCalls, ["first chunk", "second chunk"]);

	// replaceFileChunks called once with fileId + ordered, paired chunks (augmented content stored, bare body embedded)
	assert.equal(tracked.replaceFileChunksCalls.length, 1);
	const replaceCall = tracked.replaceFileChunksCalls[0];
	assert.equal(replaceCall?.fileId, NEW_FILE_ID);
	assert.deepEqual(replaceCall?.chunks, [
		{
			content: `${header}\n\nfirst chunk`,
			embedding: ["first chunk".length, 0],
			chunkIndex: 0,
		},
		{
			content: `${header}\n\nsecond chunk`,
			embedding: ["second chunk".length, 0],
			chunkIndex: 1,
		},
	]);
});

test("unchanged file with embedded chunks → skipped, no work done", async () => {
	const tracked = makeDeps({
		state: {
			fileId: 1,
			contentHash: MATCHING_HASH,
			hasStoredChunksWithEmbeddings: true,
		},
		hashContent: () => MATCHING_HASH,
	});

	const result = await processLoadedFile(FILE_PATH, tracked.deps);

	assert.deepEqual(result, { status: "skipped", chunkCount: 0 });
	assert.equal(tracked.chunkMarkdownCalls.length, 0);
	assert.equal(tracked.embedDocumentCalls.length, 0);
	assert.equal(tracked.upsertFileCalls.length, 0);
	assert.equal(tracked.replaceFileChunksCalls.length, 0);
});

test("hash matches but no stored embeddings → reprocesses", async () => {
	const tracked = makeDeps({
		state: {
			fileId: 1,
			contentHash: MATCHING_HASH,
			hasStoredChunksWithEmbeddings: false,
		},
		hashContent: () => MATCHING_HASH,
		chunkMarkdown: () => [makeChunk("only")],
	});

	const result = await processLoadedFile(FILE_PATH, tracked.deps);

	assert.deepEqual(result, { status: "processed", chunkCount: 1 });
	assert.equal(tracked.chunkMarkdownCalls.length, 1);
	assert.deepEqual(tracked.embedDocumentCalls, ["only"]);
	assert.equal(tracked.upsertFileCalls.length, 1);
	assert.equal(tracked.replaceFileChunksCalls.length, 1);
});

test("hash changed → reprocess preserves chunk↔embedding pairing and chunkIndex order", async () => {
	const chunks = [makeChunk("alpha"), makeChunk("beta"), makeChunk("gamma")];
	// Distinct embedding per chunk text so we can verify pairing.
	const header = "File: test\nPath: notes";
	const embeddingByText: Record<string, number[]> = {
		alpha: [1, 0, 0],
		beta: [0, 1, 0],
		gamma: [0, 0, 1],
	};

	const tracked = makeDeps({
		state: {
			fileId: 7,
			contentHash: DIFFERENT_HASH,
			hasStoredChunksWithEmbeddings: true,
		},
		hashContent: () => MATCHING_HASH,
		chunkMarkdown: () => chunks,
		embedDocument: async (body) => {
			const vec = embeddingByText[body];
			if (!vec) throw new Error(`unexpected embed body: ${body}`);
			return vec;
		},
		upsertFileId: 7,
	});

	const result = await processLoadedFile(FILE_PATH, tracked.deps);

	assert.deepEqual(result, { status: "processed", chunkCount: 3 });

	assert.equal(tracked.replaceFileChunksCalls.length, 1);
	const replaceCall = tracked.replaceFileChunksCalls[0];
	assert.equal(replaceCall?.fileId, 7);
	assert.deepEqual(replaceCall?.chunks, [
		{ content: `${header}\n\nalpha`, embedding: [1, 0, 0], chunkIndex: 0 },
		{ content: `${header}\n\nbeta`, embedding: [0, 1, 0], chunkIndex: 1 },
		{ content: `${header}\n\ngamma`, embedding: [0, 0, 1], chunkIndex: 2 },
	]);

	// upsertFile receives the NEW hash, not the stale stored one.
	assert.equal(tracked.upsertFileCalls[0]?.contentHash, MATCHING_HASH);
});

test("empty chunks[] → still upserts and calls replaceFileChunks with []", async () => {
	const tracked = makeDeps({
		state: null,
		chunkMarkdown: () => [],
	});

	const result = await processLoadedFile(FILE_PATH, tracked.deps);

	assert.deepEqual(result, { status: "processed", chunkCount: 0 });
	assert.equal(tracked.chunkMarkdownCalls.length, 1);
	assert.equal(tracked.embedDocumentCalls.length, 0);
	assert.equal(tracked.upsertFileCalls.length, 1);
	assert.equal(tracked.replaceFileChunksCalls.length, 1);
	assert.deepEqual(tracked.replaceFileChunksCalls[0]?.chunks, []);
});
