import { defineCommand, runMain } from "citty";
import { loadCommand } from "./commands/load";
import { queryCommand } from "./commands/query";
import { db } from "./database/client";

const main = defineCommand({
	meta: {
		name: "notes-query-tool",
		version: "1.0.0",
		description: "Notes query tool (think of a better description later)",
	},
	subCommands: {
		load: loadCommand,
		query: queryCommand,
	},
	async cleanup() {
		await db.$client.close();
	},
});

await runMain(main);

process.on("unhandledRejection", (reason) => {
	console.error("Unhandled Rejection:", reason);
	db.$client.close().finally(() => process.exit(1));
});
