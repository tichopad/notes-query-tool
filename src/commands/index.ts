import { defineCommand } from "citty";
import { loadFiles } from "../load-files";

export const indexCommand = defineCommand({
	meta: {
		name: "index",
		description: "Index notes files",
	},
	args: {
		globPattern: {
			type: "positional",
			description: "Files glob (e.g. 'notes/**/*.md')",
			required: true,
		},
	},
	setup({ args }) {
		console.log(`now setup ${args.globPattern}`);
	},
	cleanup({ args }) {
		console.log(`now cleanup ${args.globPattern}`);
	},
	async run({ args }) {
		for await (const file of loadFiles(args.globPattern)) {
			console.log(file);
		}
	},
});
