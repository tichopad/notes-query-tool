import type { Chunk } from "../../files/chunker";
import { decideFileProcessing } from "./decide-file-processing";
import type { FileProcessingState } from "./load-repository";

export type FileLoadResult = {
	status: "skipped" | "processed";
	chunkCount: number;
};

export type LoadRepositoryLike = {
	getFileProcessingState(filePath: string): Promise<FileProcessingState>;
	upsertFile(
		filePath: string,
		contentHash: string,
		title: string | null,
		updatedAt: Date,
	): Promise<{ id: number }>;
	replaceFileChunks(
		fileId: number,
		chunks: Array<{ content: string; embedding: number[]; chunkIndex: number }>,
	): Promise<void>;
};

export type ProcessFileDeps = {
	repo: LoadRepositoryLike;
	readText(filePath: string): Promise<string>;
	hashContent(content: string): string;
	chunkMarkdown(content: string, ...args: unknown[]): Chunk[];
	embed(text: string): Promise<number[]>;
	log(line: string): void;
};

export async function processLoadedFile(
	filePath: string,
	deps: ProcessFileDeps,
): Promise<FileLoadResult> {
	const { repo, readText, hashContent, chunkMarkdown, embed, log } = deps;

	const content = await readText(filePath);
	const contentHash = hashContent(content);

	const existingState = await repo.getFileProcessingState(filePath);
	const decision = decideFileProcessing(contentHash, existingState);

	if (decision.action === "skip") {
		log(`${filePath} -> skipped (unchanged)`);
		return { status: "skipped", chunkCount: 0 };
	}

	const chunks = chunkMarkdown(content, 4000);

	const { id: fileId } = await repo.upsertFile(
		filePath,
		contentHash,
		null,
		new Date(),
	);

	const chunkDocs = await Promise.all(
		chunks.map(async (chunk, i) => ({
			content: chunk.text,
			embedding: await embed(chunk.text),
			chunkIndex: i,
		})),
	);

	await repo.replaceFileChunks(fileId, chunkDocs);

	log(`${filePath} → ${chunks.length} chunks`);

	return { status: "processed", chunkCount: chunks.length };
}
