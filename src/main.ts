import { defineCommand, runMain } from "citty";
import { loadFiles } from "./load-files";

const main = defineCommand({
	meta: {
		name: "notes-query-tool",
		version: "1.0.0",
		description: "My Awesome CLI App",
	},
	args: {
		pattern: {
			type: "positional",
			description: "Files glob",
			required: true,
		},
	},
	setup({ args }) {
		console.log(`now setup ${args.pattern}`);
	},
	cleanup({ args }) {
		console.log(`now cleanup ${args.pattern}`);
	},
	async run({ args }) {
		for await (const file of loadFiles(args.pattern)) {
			console.log(file);
		}
	},
});

runMain(main);
