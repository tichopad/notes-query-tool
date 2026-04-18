import { sql } from "drizzle-orm";
import { integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const filesTable = pgTable("files", {
	id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
	filePath: text("file_path").notNull().unique(),
	contentHash: text("content_hash").notNull(),
	attributes: jsonb("attributes").$type<Record<string, unknown>>(),
	createdAt: timestamp("created_at").notNull().default(sql`now()`),
	updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
});

export type File = typeof filesTable.$inferSelect;
export type NewFile = typeof filesTable.$inferInsert;
