import { defineCommand, runMain } from "citty";
import { indexCommand } from "./commands";

const main = defineCommand({
	meta: {
		name: "notes-query-tool",
		version: "1.0.0",
		description: "Notes query tool (think of a better description later)",
	},
	subCommands: {
		index: indexCommand,
	},
});

runMain(main);
