import { and, count, eq, isNotNull, sql } from "drizzle-orm";
import { db as defaultDb, type PgliteDatabase } from "../../database/client.ts";
import { chunksTable, type NewChunk } from "../../database/schema/chunks.ts";
import { filesTable } from "../../database/schema/files.ts";

export type FileProcessingState = {
	fileId: number;
	contentHash: string;
	hasStoredChunksWithEmbeddings: boolean;
} | null;

export interface LoadRepository {
	getFileProcessingState(filePath: string): Promise<FileProcessingState>;
	upsertFile(
		filePath: string,
		contentHash: string,
		title: string | null,
		updatedAt: Date,
	): Promise<{ id: number }>;
	replaceFileChunks(
		fileId: number,
		chunks: Array<{
			content: string;
			embedding: number[];
			chunkIndex: number;
			breadcrumbs: string[];
		}>,
	): Promise<void>;
}

export class DbLoadRepository implements LoadRepository {
	private readonly db: PgliteDatabase;

	constructor(db: PgliteDatabase = defaultDb) {
		this.db = db;
	}

	async getFileProcessingState(filePath: string): Promise<FileProcessingState> {
		const [file] = await this.db
			.select({ id: filesTable.id, contentHash: filesTable.contentHash })
			.from(filesTable)
			.where(eq(filesTable.filePath, filePath))
			.limit(1);

		if (!file) {
			return null;
		}

		const [totalResult] = await this.db
			.select({ total: count() })
			.from(chunksTable)
			.where(eq(chunksTable.fileId, file.id));

		const [withEmbeddingResult] = await this.db
			.select({ withEmbedding: count() })
			.from(chunksTable)
			.where(
				and(eq(chunksTable.fileId, file.id), isNotNull(chunksTable.embedding)),
			);

		const total = totalResult?.total ?? 0;
		const withEmbedding = withEmbeddingResult?.withEmbedding ?? 0;
		const hasStoredChunksWithEmbeddings = total > 0 && withEmbedding === total;

		return {
			fileId: file.id,
			contentHash: file.contentHash,
			hasStoredChunksWithEmbeddings,
		};
	}

	async upsertFile(
		filePath: string,
		contentHash: string,
		title: string | null,
		_updatedAt: Date,
	): Promise<{ id: number }> {
		const attributes: Record<string, unknown> = {};
		if (title !== null) {
			attributes.title = title;
		}

		const [file] = await this.db
			.insert(filesTable)
			.values({ filePath, contentHash, attributes })
			.onConflictDoUpdate({
				target: filesTable.filePath,
				set: {
					contentHash,
					attributes,
					updatedAt: sql`now()`,
				},
			})
			.returning({ id: filesTable.id });

		if (!file) {
			throw new Error(`Failed to upsert file: ${filePath}`);
		}

		return { id: file.id };
	}

	async replaceFileChunks(
		fileId: number,
		chunks: Array<{
			content: string;
			embedding: number[];
			chunkIndex: number;
			breadcrumbs: string[];
		}>,
	): Promise<void> {
		await this.db.transaction(async (tx) => {
			await tx.delete(chunksTable).where(eq(chunksTable.fileId, fileId));

			if (chunks.length > 0) {
				const newChunks = chunks.map(
					(chunk) =>
						({
							fileId,
							chunkIndex: chunk.chunkIndex,
							content: chunk.content,
							breadcrumbs: chunk.breadcrumbs,
							embedding: chunk.embedding,
							fts: sql`to_tsvector('simple', unaccent(${chunk.content}))` as unknown as string,
						}) satisfies NewChunk,
				);

				await tx.insert(chunksTable).values(newChunks);
			}
		});
	}
}
