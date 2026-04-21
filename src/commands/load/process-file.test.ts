import { expect, test } from "bun:test";
import type { Chunk } from "../../files/chunker";
import type { FileProcessingState } from "./load-repository";
import {
	type LoadRepositoryLike,
	type ProcessFileDeps,
	processLoadedFile,
} from "./process-file";

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
	embedCalls: string[];
};

type MakeDepsOverrides = {
	state?: FileProcessingState;
	readText?: (filePath: string) => Promise<string>;
	hashContent?: (content: string) => string;
	chunkMarkdown?: (content: string, ...args: unknown[]) => Chunk[];
	embed?: (text: string) => Promise<number[]>;
	log?: (line: string) => void;
	upsertFileId?: number;
};

function makeDeps(overrides: MakeDepsOverrides = {}): TrackedDeps {
	const chunkMarkdownCalls: ChunkMarkdownCall[] = [];
	const upsertFileCalls: UpsertFileCall[] = [];
	const replaceFileChunksCalls: ReplaceFileChunksCall[] = [];
	const embedCalls: string[] = [];

	const state = overrides.state ?? null;
	const upsertFileId = overrides.upsertFileId ?? NEW_FILE_ID;

	const repo: LoadRepositoryLike = {
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
	const embed = overrides.embed ?? (async () => [0.1, 0.2]);

	const deps: ProcessFileDeps = {
		repo,
		readText: overrides.readText ?? (async () => FAKE_CONTENT),
		hashContent: overrides.hashContent ?? (() => MATCHING_HASH),
		chunkMarkdown: (content, ...args) => {
			chunkMarkdownCalls.push({ content, args });
			return chunkMarkdown(content, ...args);
		},
		embed: async (text) => {
			embedCalls.push(text);
			return embed(text);
		},
		log: overrides.log ?? (() => {}),
	};

	return {
		deps,
		chunkMarkdownCalls,
		upsertFileCalls,
		replaceFileChunksCalls,
		embedCalls,
	};
}

test("new file (state=null) → chunks, embeds, upserts, replaces with correct payload", async () => {
	const chunks = [makeChunk("first chunk"), makeChunk("second chunk")];
	const tracked = makeDeps({
		state: null,
		chunkMarkdown: () => chunks,
		embed: async (text) => [text.length, 0],
	});

	const result = await processLoadedFile(FILE_PATH, tracked.deps);

	expect(result).toEqual({ status: "processed", chunkCount: 2 });

	// chunkMarkdown called once with content + size 4000
	expect(tracked.chunkMarkdownCalls).toHaveLength(1);
	expect(tracked.chunkMarkdownCalls[0]?.content).toBe(FAKE_CONTENT);
	expect(tracked.chunkMarkdownCalls[0]?.args).toEqual([4000]);

	// upsertFile called once with the right args
	expect(tracked.upsertFileCalls).toHaveLength(1);
	const upsertCall = tracked.upsertFileCalls[0];
	expect(upsertCall?.filePath).toBe(FILE_PATH);
	expect(upsertCall?.contentHash).toBe(MATCHING_HASH);
	expect(upsertCall?.title).toBeNull();
	expect(upsertCall?.updatedAt).toBeInstanceOf(Date);

	// embed called per chunk, in order
	expect(tracked.embedCalls).toEqual(["first chunk", "second chunk"]);

	// replaceFileChunks called once with fileId + ordered, paired chunks
	expect(tracked.replaceFileChunksCalls).toHaveLength(1);
	const replaceCall = tracked.replaceFileChunksCalls[0];
	expect(replaceCall?.fileId).toBe(NEW_FILE_ID);
	expect(replaceCall?.chunks).toEqual([
		{ content: "first chunk", embedding: [11, 0], chunkIndex: 0 },
		{ content: "second chunk", embedding: [12, 0], chunkIndex: 1 },
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

	expect(result).toEqual({ status: "skipped", chunkCount: 0 });
	expect(tracked.chunkMarkdownCalls).toHaveLength(0);
	expect(tracked.embedCalls).toHaveLength(0);
	expect(tracked.upsertFileCalls).toHaveLength(0);
	expect(tracked.replaceFileChunksCalls).toHaveLength(0);
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

	expect(result).toEqual({ status: "processed", chunkCount: 1 });
	expect(tracked.chunkMarkdownCalls).toHaveLength(1);
	expect(tracked.embedCalls).toEqual(["only"]);
	expect(tracked.upsertFileCalls).toHaveLength(1);
	expect(tracked.replaceFileChunksCalls).toHaveLength(1);
});

test("hash changed → reprocess preserves chunk↔embedding pairing and chunkIndex order", async () => {
	const chunks = [makeChunk("alpha"), makeChunk("beta"), makeChunk("gamma")];
	// Distinct embedding per chunk text so we can verify pairing.
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
		embed: async (text) => {
			const vec = embeddingByText[text];
			if (!vec) throw new Error(`unexpected embed text: ${text}`);
			return vec;
		},
		upsertFileId: 7,
	});

	const result = await processLoadedFile(FILE_PATH, tracked.deps);

	expect(result).toEqual({ status: "processed", chunkCount: 3 });

	expect(tracked.replaceFileChunksCalls).toHaveLength(1);
	const replaceCall = tracked.replaceFileChunksCalls[0];
	expect(replaceCall?.fileId).toBe(7);
	expect(replaceCall?.chunks).toEqual([
		{ content: "alpha", embedding: [1, 0, 0], chunkIndex: 0 },
		{ content: "beta", embedding: [0, 1, 0], chunkIndex: 1 },
		{ content: "gamma", embedding: [0, 0, 1], chunkIndex: 2 },
	]);

	// upsertFile receives the NEW hash, not the stale stored one.
	expect(tracked.upsertFileCalls[0]?.contentHash).toBe(MATCHING_HASH);
});

test("empty chunks[] → still upserts and calls replaceFileChunks with []", async () => {
	const tracked = makeDeps({
		state: null,
		chunkMarkdown: () => [],
	});

	const result = await processLoadedFile(FILE_PATH, tracked.deps);

	expect(result).toEqual({ status: "processed", chunkCount: 0 });
	expect(tracked.chunkMarkdownCalls).toHaveLength(1);
	expect(tracked.embedCalls).toHaveLength(0);
	expect(tracked.upsertFileCalls).toHaveLength(1);
	expect(tracked.replaceFileChunksCalls).toHaveLength(1);
	expect(tracked.replaceFileChunksCalls[0]?.chunks).toEqual([]);
});
