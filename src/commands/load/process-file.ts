import path from "node:path";
import { CHUNK_LIMIT_CHARS } from "../../config.ts";
import type { Chunk } from "../../files/chunker.ts";
import { extractFrontmatter } from "../../files/frontmatter.ts";
import { logger } from "../../logger.ts";
import { buildDocumentHeader } from "./build-document-header.ts";
import { decideFileProcessing } from "./decide-file-processing.ts";
import type { LoadRepository } from "./load-repository.ts";

export type FileLoadResult = {
	status: "skipped" | "processed";
	chunkCount: number;
};

export type ProcessFileDeps = {
	repo: LoadRepository;
	readText(filePath: string): Promise<string>;
	hashContent(content: string): string;
	chunkMarkdown(content: string, ...args: unknown[]): Chunk[];
	embedDocument(body: string, title?: string | null): Promise<number[]>;
};

export async function processLoadedFile(
	filePath: string,
	deps: ProcessFileDeps,
): Promise<FileLoadResult> {
	const { repo, readText, hashContent, chunkMarkdown, embedDocument } = deps;

	const content = await readText(filePath);
	const contentHash = hashContent(content);

	const existingState = await repo.getFileProcessingState(filePath);
	const decision = decideFileProcessing(contentHash, existingState);
	logger.debug(`[${filePath}] decision: ${decision.action}`);

	if (decision.action === "skip") {
		logger.info(`${filePath} -> skipped (unchanged)`);
		return { status: "skipped", chunkCount: 0 };
	}

	const { attributes, body } = extractFrontmatter(content);

	const basename = path.basename(filePath, ".md");
	const parentDir = path.basename(path.dirname(filePath));
	const { headerPrefix, titleString } = buildDocumentHeader(
		basename,
		parentDir,
		attributes,
	);

	const chunks = chunkMarkdown(body || content, CHUNK_LIMIT_CHARS);
	logger.debug(`[${filePath}] produced ${chunks.length} chunks`);

	const { id: fileId } = await repo.upsertFile(
		filePath,
		contentHash,
		null,
		new Date(),
	);

	const chunkDocs = await Promise.all(
		chunks.map(async (chunk, i) => {
			const augmented = `${headerPrefix}\n\n${chunk.text}`;
			const bodyText = chunk.text.trim();
			const embedding = bodyText
				? await embedDocument(bodyText, titleString)
				: await embedDocument(augmented, titleString);
			logger.trace(`[${filePath}] chunk ${i} embedded (${embedding.length}d)`);
			return {
				content: augmented,
				embedding,
				chunkIndex: i,
				breadcrumbs: chunk.breadcrumb,
			};
		}),
	);

	await repo.replaceFileChunks(fileId, chunkDocs);
	logger.debug(`[${filePath}] chunks written to DB`);

	logger.info(`${filePath} → ${chunks.length} chunks`);

	return { status: "processed", chunkCount: chunks.length };
}
