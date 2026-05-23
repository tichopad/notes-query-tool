import { sql } from "drizzle-orm";
import {
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	unique,
} from "drizzle-orm/pg-core";
import { basesTable } from "./bases.ts";

export const filesTable = pgTable(
	"files",
	{
		id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
		baseId: integer("base_id")
			.notNull()
			.references(() => basesTable.id, { onDelete: "cascade" }),
		filePath: text("file_path").notNull(),
		contentHash: text("content_hash").notNull(),
		attributes: jsonb("attributes").$type<Record<string, unknown>>(),
		createdAt: timestamp("created_at").notNull().default(sql`now()`),
		updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
	},
	(table) => [unique().on(table.baseId, table.filePath)],
);

export type File = typeof filesTable.$inferSelect;
export type NewFile = typeof filesTable.$inferInsert;
