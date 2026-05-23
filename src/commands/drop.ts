import { createInterface } from "node:readline";
import { defineCommand } from "citty";
import { DbBaseRepository } from "../database/base-repository.ts";

export const dropCommand = defineCommand({
	meta: {
		name: "drop",
		description: "Drop a knowledge base and all its indexed data",
	},
	args: {
		base: {
			type: "string",
			description: "Knowledge base name to drop",
			default: "default",
		},
		force: {
			type: "boolean",
			description: "Skip confirmation prompt",
			default: false,
		},
	},
	async run({ args }) {
		const baseRepo = new DbBaseRepository();
		const base = await baseRepo.getBaseByName(args.base);

		if (!base) {
			console.error(`Error: Base '${args.base}' not found.`);
			process.exit(1);
		}

		if (!args.force) {
			const confirmed = await confirm(
				`Are you sure you want to drop base '${args.base}'? [y/N] `,
			);
			if (!confirmed) {
				console.log("Aborted.");
				return;
			}
		}

		await baseRepo.deleteBase(args.base);
		console.log(`Base '${args.base}' dropped.`);
	},
});

function confirm(prompt: string): Promise<boolean> {
	return new Promise((resolve) => {
		const rl = createInterface({
			input: process.stdin,
			output: process.stdout,
		});
		rl.question(prompt, (answer) => {
			rl.close();
			resolve(answer.toLowerCase() === "y" || answer.toLowerCase() === "yes");
		});
	});
}
