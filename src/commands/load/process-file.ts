import path from "node:path";
import { CHUNK_LIMIT_CHARS } from "../../config.ts";
import type { Chunk } from "../../files/chunker.ts";
import { extractFrontmatter } from "../../files/frontmatter.ts";
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
	log(line: string): void;
};

export async function processLoadedFile(
	filePath: string,
	deps: ProcessFileDeps,
): Promise<FileLoadResult> {
	const { repo, readText, hashContent, chunkMarkdown, embedDocument, log } =
		deps;

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

	// Build titleString for embedDocument's title slot (basename + frontmatter fields)
	const titleParts: string[] = [basename];
	if (attributes) {
		const fmTitle = attributes.title;
		if (typeof fmTitle === "string" && fmTitle && fmTitle !== basename)
			titleParts.push(fmTitle);
		const aliases = attributes.aliases;
		if (Array.isArray(aliases) && aliases.length > 0)
			titleParts.push(`aliases: ${aliases.join(", ")}`);
		const tags = attributes.tags;
		if (Array.isArray(tags) && tags.length > 0)
			titleParts.push(`tags: ${tags.join(", ")}`);
	}
	const titleString = titleParts.join("; ");

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
			const bodyText = chunk.text.trim();
			return {
				content: augmented,
				embedding: bodyText
					? await embedDocument(bodyText, titleString)
					: await embedDocument(augmented, titleString),
				chunkIndex: i,
				breadcrumbs: chunk.breadcrumb,
			};
		}),
	);

	await repo.replaceFileChunks(fileId, chunkDocs);

	log(`${filePath} → ${chunks.length} chunks`);

	return { status: "processed", chunkCount: chunks.length };
}
