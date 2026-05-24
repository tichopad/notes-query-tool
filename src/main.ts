import { defineCommand, runMain } from "citty";
import packageJson from "../package.json" with { type: "json" };
import { dropCommand } from "./commands/drop.ts";
import { loadCommand } from "./commands/load.ts";
import { queryCommand } from "./commands/query.ts";
import { getDb } from "./database/client.ts";
import { runMigrations } from "./database/migrate.ts";
import { logger, setLogLevel } from "./logger.ts";

// Setup DB and register subcommands
const main = defineCommand({
	meta: {
		name: "notes-query-tool",
		version: packageJson.version,
		description: packageJson.description,
		alias: "nqt",
	},
	args: {
		verbose: {
			type: "boolean",
			description: "Enable verbose logging (sets log level to max)",
			default: false,
		},
		base: {
			type: "string",
			description: "Knowledge base name to use",
			default: "default",
		},
	},
	subCommands: {
		// Handles loading notes, chunking and indexing them in the database
		load: loadCommand,
		// Handles querying the indexed notes
		query: queryCommand,
		// Handles dropping a knowledge base and all its indexed data
		drop: dropCommand,
	},
	// Runs before any subcommand
	async setup({ args }) {
		if (args.verbose) {
			setLogLevel(999); // consola: log everything
		}
		const db = getDb();
		await db.$client.waitReady;
		await runMigrations(db);
	},
	// Runs after the subcommand finishes
	async cleanup() {
		await getDb().$client.close();
	},
});

// Run the handler
await runMain(main).catch((error) => {
	closeDbAndExit(`Error: ${error}`, 1);
});

// Global error handlers to ensure DB connection is closed on unexpected errors or termination
// Not closing the connection properly can lead to issues like locked database files
process.on("unhandledRejection", (reason) => {
	closeDbAndExit(`Unhandled Rejection: ${reason}`, 1);
});
process.on("uncaughtException", (error) => {
	closeDbAndExit(`Uncaught Exception: ${error}`, 1);
});
process.on("SIGINT", () => {
	closeDbAndExit("Received SIGINT, shutting down...", 0);
});

function closeDbAndExit(message: string, code: number) {
	logger.error(message);
	getDb()
		.$client.close()
		.finally(() => process.exit(code));
}
