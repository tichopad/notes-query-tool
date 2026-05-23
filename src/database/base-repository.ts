import { eq } from "drizzle-orm";
import { getDb, type PgliteDatabase } from "./client.ts";
import { type Base, basesTable } from "./schema/bases.ts";

export interface BaseRepository {
	getBaseByName(name: string): Promise<Base | undefined>;
	getOrCreateBase(name: string): Promise<Base>;
	deleteBase(name: string): Promise<void>;
}

export class DbBaseRepository implements BaseRepository {
	private readonly db: PgliteDatabase;

	constructor(db?: PgliteDatabase) {
		this.db = db ?? getDb();
	}

	async getBaseByName(name: string): Promise<Base | undefined> {
		const [base] = await this.db
			.select()
			.from(basesTable)
			.where(eq(basesTable.name, name))
			.limit(1);
		return base;
	}

	async getOrCreateBase(name: string): Promise<Base> {
		const existing = await this.getBaseByName(name);
		if (existing) {
			return existing;
		}

		const [created] = await this.db
			.insert(basesTable)
			.values({ name })
			.returning();

		if (!created) {
			throw new Error(`Failed to create base: ${name}`);
		}

		return created;
	}

	async deleteBase(name: string): Promise<void> {
		await this.db.delete(basesTable).where(eq(basesTable.name, name));
	}
}
