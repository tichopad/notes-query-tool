import { defineCommand } from "citty";
import { db } from "../database/client";
import { notesTable } from "../database/schema/notes";
import { chunkMarkdown } from "../files/chunker";
import { loadFilesByGlob } from "../files/load-files";

export const loadCommand = defineCommand({
	meta: {
		name: "load",
		description: "Load notes files",
	},
	args: {
		glob: {
			type: "string",
			description: "Files glob (e.g. 'notes/**/*.md')",
			required: true,
		},
	},
	async run({ args }) {
		// Just testing it here
		const chunkedRecords: { id: string; chunks: string[] }[] = [];
		for await (const filePath of loadFilesByGlob(args.glob)) {
			console.log(filePath);
			const file = await Bun.file(filePath).text();
			const chunks = chunkMarkdown(file, 1000);
			const chunkedRecord = {
				id: filePath,
				chunks: chunks.map((c): string => {
					const breadcrumbPath = c.breadcrumb
						.map((b) => b.replaceAll("#", "").trim())
						.join(">");
					return `${filePath}:${breadcrumbPath}:${c.text}`;
				}),
			};
			chunkedRecords.push(chunkedRecord);
		}
		await Bun.write(
			"chunked-records.json",
			JSON.stringify(chunkedRecords, null, 2),
		);
	},
});
