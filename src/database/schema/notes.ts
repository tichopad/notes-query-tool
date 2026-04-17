import { sql } from "drizzle-orm";
import { integer, pgTable, text, timestamp, vector } from "drizzle-orm/pg-core";

export const notesTable = pgTable("notes", {
	id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
	filePath: text("file_path").notNull().unique(),
	title: text("title"),
	content: text("content").notNull(),
	embedding: vector("embedding", { dimensions: 1536 }),
	createdAt: timestamp("created_at").notNull().default(sql`now()`),
	updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
});

export type Note = typeof notesTable.$inferSelect;
export type NewNote = typeof notesTable.$inferInsert;
