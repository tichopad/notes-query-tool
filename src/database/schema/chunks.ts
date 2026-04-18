import { sql } from "drizzle-orm";
import { integer, pgTable, text, timestamp, vector } from "drizzle-orm/pg-core";
import { filesTable } from "./files";

export const chunksTable = pgTable("chunks", {
	id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
	fileId: integer("file_id")
		.notNull()
		.references(() => filesTable.id, { onDelete: "cascade" }),
	chunkIndex: integer("chunk_index").notNull(),
	content: text("content").notNull(),
	breadcrumbs: text("breadcrumbs").array().notNull(),
	embedding: vector("embedding", { dimensions: 1024 }),
	createdAt: timestamp("created_at").notNull().default(sql`now()`),
	updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
});

export type Chunk = typeof chunksTable.$inferSelect;
export type NewChunk = typeof chunksTable.$inferInsert;
