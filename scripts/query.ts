import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { unaccent } from "@electric-sql/pglite/contrib/unaccent";
import { vector } from "@electric-sql/pglite/vector";

const ROW_CAP = Number(process.env.DB_QUERY_LIMIT ?? 200);
const CELL_MAX = 200;

function formatCell(val: unknown): string {
	if (val === null || val === undefined) return "NULL";
	if (val instanceof Date) return val.toISOString();
	if (
		Array.isArray(val) &&
		val.length > 8 &&
		val.every((v) => typeof v === "number")
	) {
		return `[${val.length} floats]`;
	}
	if (typeof val === "object") return JSON.stringify(val);
	const s = String(val);
	const escaped = s.replace(/\n/g, "\\n");
	if (escaped.length > CELL_MAX) return `${escaped.slice(0, CELL_MAX)}\u2026`;
	return escaped;
}

function printResult(
	result: {
		rows: Record<string, unknown>[];
		fields: { name: string }[];
		affectedRows?: number;
	},
	index: number,
	total: number,
): void {
	if (total > 1) process.stdout.write(`-- result ${index + 1} --\n`);

	const { rows, fields, affectedRows } = result;

	if (rows.length === 0 && (fields?.length ?? 0) === 0) {
		const affected =
			affectedRows !== undefined ? `affected=${affectedRows}` : "";
		process.stdout.write(`ok${affected ? ` ${affected}` : ""}\n`);
		return;
	}

	const cols = fields.map((f) => f.name);
	const capped = rows.length > ROW_CAP;
	const printed = capped ? rows.slice(0, ROW_CAP) : rows;

	process.stdout.write(`rows=${rows.length} cols=${cols.join(",")}\n`);
	process.stdout.write(`${cols.join("\t")}\n`);
	for (const row of printed) {
		process.stdout.write(`${cols.map((c) => formatCell(row[c])).join("\t")}\n`);
	}
	if (capped) {
		process.stdout.write(`\u2026 (${rows.length - ROW_CAP} more rows)\n`);
	}
}

// --- input ---
let sql: string | undefined;

if (process.argv[2]) {
	sql = process.argv[2];
} else if (!process.stdin.isTTY) {
	const chunks: Uint8Array[] = [];
	for await (const chunk of process.stdin) {
		chunks.push(chunk instanceof Uint8Array ? chunk : Buffer.from(chunk));
	}
	sql = Buffer.concat(chunks).toString("utf8").trim();
}

if (!sql) {
	process.stderr.write(
		'usage: bun db:query "<SQL>"\n       echo "<SQL>" | bun db:query\n',
	);
	process.exit(1);
}

// --- run ---
const pglite = new PGlite({
	dataDir: "./dbdata/",
	extensions: { unaccent, vector, pg_trgm },
});

try {
	const results = await pglite.exec(sql);
	const multi = results.length > 1;
	for (let i = 0; i < results.length; i++) {
		if (multi && i > 0) process.stdout.write("\n");
		printResult(
			results[i] as {
				rows: Record<string, unknown>[];
				fields: { name: string }[];
				affectedRows?: number;
			},
			i,
			results.length,
		);
	}
} catch (err) {
	process.stderr.write(
		`ERROR: ${err instanceof Error ? err.message : String(err)}\n`,
	);
	process.exit(1);
} finally {
	await pglite.close();
}
