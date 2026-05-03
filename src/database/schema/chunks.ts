import { sql } from "drizzle-orm";
import {
	customType,
	index,
	integer,
	pgTable,
	text,
	timestamp,
	vector,
} from "drizzle-orm/pg-core";
import { EMBEDDING_DIMS } from "../../config.ts";
import { filesTable } from "./files.ts";

const tsvector = customType<{ data: string }>({
	dataType() {
		return "tsvector";
	},
});

export const chunksTable = pgTable(
	"chunks",
	{
		id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
		fileId: integer("file_id")
			.notNull()
			.references(() => filesTable.id, { onDelete: "cascade" }),
		chunkIndex: integer("chunk_index").notNull(),
		content: text("content").notNull(),
		breadcrumbs: text("breadcrumbs").array().notNull(),
		embedding: vector("embedding", { dimensions: EMBEDDING_DIMS }),
		fts: tsvector("fts"),
		createdAt: timestamp("created_at").notNull().default(sql`now()`),
		updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
	},
	(table) => [index("chunks_fts_idx").using("gin", table.fts)],
);

export type Chunk = typeof chunksTable.$inferSelect;
export type NewChunk = typeof chunksTable.$inferInsert;
