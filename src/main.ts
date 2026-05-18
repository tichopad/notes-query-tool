import { defineCommand, runMain } from "citty";
import { loadCommand } from "./commands/load.ts";
import { queryCommand } from "./commands/query.ts";
import { db } from "./database/client.ts";
import { runMigrations } from "./database/migrate.ts";
import { logger, setLogLevel } from "./logger.ts";

// Setup DB and register subcommands
const main = defineCommand({
	meta: {
		name: "notes-query-tool",
		version: "1.0.0",
		description: "Notes query tool (think of a better description later)",
	},
	args: {
		verbose: {
			type: "boolean",
			description: "Enable verbose logging (sets log level to max)",
			default: false,
		},
	},
	subCommands: {
		// Handles loading notes, chunking and indexing them in the database
		load: loadCommand,
		// Handles querying the indexed notes
		query: queryCommand,
	},
	// Runs before any subcommand
	async setup({ args }) {
		if (args.verbose) {
			setLogLevel(999); // consola: log everything
		}
		await db.$client.waitReady;
		await runMigrations(db);
	},
	// Runs after the subcommand finishes
	async cleanup() {
		await db.$client.close();
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
	db.$client.close().finally(() => process.exit(code));
}
