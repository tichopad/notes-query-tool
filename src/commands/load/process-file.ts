import path from "node:path";
import type { Chunk } from "../../files/chunker";
import { extractFrontmatter } from "../../files/frontmatter";
import { decideFileProcessing } from "./decide-file-processing";
import type { FileProcessingState } from "./load-repository";

export type FileLoadResult = {
	status: "skipped" | "processed";
	chunkCount: number;
};

const CHUNK_LIMIT_CHARS = 2000;

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

	const { attributes, body } = extractFrontmatter(content);

	// Build header prefix: filename + path + optional frontmatter fields
	const basename = path.basename(filePath, ".md");
	const parentDir = path.basename(path.dirname(filePath));
	const headerLines = [`File: ${basename}`, `Path: ${parentDir}`];
	if (attributes) {
		const title = attributes.title;
		if (typeof title === "string" && title) headerLines.push(`Title: ${title}`);
		const aliases = attributes.aliases;
		if (Array.isArray(aliases) && aliases.length > 0)
			headerLines.push(`Aliases: ${aliases.join(", ")}`);
		const tags = attributes.tags;
		if (Array.isArray(tags) && tags.length > 0)
			headerLines.push(`Tags: ${tags.join(", ")}`);
	}
	const headerPrefix = headerLines.join("\n");

	const chunks = chunkMarkdown(body || content, CHUNK_LIMIT_CHARS);

	const { id: fileId } = await repo.upsertFile(
		filePath,
		contentHash,
		null,
		new Date(),
	);

	const chunkDocs = await Promise.all(
		chunks.map(async (chunk, i) => {
			const augmented = `${headerPrefix}\n\n${chunk.text}`;
			return {
				content: augmented,
				embedding: await embed(augmented),
				chunkIndex: i,
			};
		}),
	);

	await repo.replaceFileChunks(fileId, chunkDocs);

	log(`${filePath} → ${chunks.length} chunks`);

	return { status: "processed", chunkCount: chunks.length };
}
