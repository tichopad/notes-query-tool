import { unlink, writeFile } from "node:fs/promises";
import { defineCommand } from "citty";
import { stringify as stringifyYaml } from "yaml";
import { DbBaseRepository } from "../database/base-repository.ts";
import { initEmbedder } from "../embedder.ts";
import { logger } from "../logger.ts";
import { executeQuery } from "../query/execute.ts";

export const queryCommand = defineCommand({
	meta: {
		name: "query",
		description: "Search notes by semantic query",
	},
	args: {
		vector: {
			type: "string",
			alias: "v",
			description: "Semantic query for vector search",
			required: true,
		},
		fulltext: {
			type: "string",
			alias: "f",
			description:
				'Keyword query for full-text search (supports PostgreSQL websearch syntax: OR, -word, "phrases")',
			required: true,
		},
		trigram: {
			type: "string",
			alias: "g",
			description:
				"Plain-text keyword for trigram search (defaults to --fulltext)",
			required: false,
		},
		trigramMode: {
			type: "string",
			alias: "t",
			description:
				"Trigram operator: 'strict' (strict_word_similarity, <<%) or 'word' (word_similarity, <%)",
			default: "strict",
		},
		base: {
			type: "string",
			description: "Knowledge base name to use",
			default: "default",
		},
	},
	async run({ args }) {
		const mode = args.trigramMode;
		if (mode !== "strict" && mode !== "word") {
			throw new Error(
				`Invalid --trigram-mode "${mode}". Must be "strict" or "word".`,
			);
		}

		const baseRepo = new DbBaseRepository();
		const base = await baseRepo.getBaseByName(args.base);
		if (!base) {
			logger.error(`Base '${args.base}' does not exist.`);
			process.exit(1);
		}

		const embedder = await initEmbedder();

		const results = await executeQuery({
			vectorText: args.vector,
			queryText: args.fulltext,
			trigramText: args.trigram,
			embedQuery: embedder.embedQuery.bind(embedder),
			trigramMode: mode,
			baseId: base.id,
		});

		if (results.length === 0) {
			logger.info("No matching chunks found.");
			return;
		}

		for (const row of results) {
			let output = "";
			output += `<file path="${row.filePath}">\n`;
			output += `<meta>\n`;
			output += `Chunk index: ${row.chunkIndex}\n`;
			output += `Score: ${Number(row.score).toFixed(3)}\n`;
			if (row.breadcrumbs.length > 0) {
				output += `Breadcrumbs: ${row.breadcrumbs.join(" > ")}\n`;
			}
			output += `</meta>\n`;
			output += `<content>\n`;
			output += `${row.content}\n`;
			output += `</content>\n`;
			output += `</file>\n`;
			console.log(output);
		}

		// console.log("\nFinal merged results:");
		// for (const row of results) {
		// 	const breadcrumb = row.breadcrumbs
		// 		.map((b) => b.replaceAll("#", "").trim())
		// 		.join(" > ");
		// 	const header = breadcrumb
		// 		? `${row.filePath} [${row.chunkIndex}] ${breadcrumb}`
		// 		: `${row.filePath} [${row.chunkIndex}]`;

		// 	console.log(`${header} (score: ${Number(row.score).toFixed(3)})`);
		// }

		await unlink("query_results.yaml").catch(() => {});
		await writeFile("query_results.yaml", stringifyYaml(results));
	},
});
