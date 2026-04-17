import { defineCommand } from "citty";
import { db } from "../database/client";
import { notesTable } from "../database/schema/notes";
import { loadFilesByGlob } from "../files/load-files";

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
	async run({ args }) {
		for await (const file of loadFilesByGlob(args.globPattern)) {
			console.log(file);
		}
		const x = await db
			.select({ filePath: notesTable.filePath })
			.from(notesTable);
		console.log(x);
	},
});
