import type { Dirent } from "node:fs";
import { glob } from "node:fs/promises";
import { basename } from "node:path";

export async function* loadFilesByGlob(
	globPattern: string,
): AsyncIterable<string> {
	for await (const entry of glob(globPattern, {
		withFileTypes: true,
		exclude: (f: Dirent) => {
			const b = basename(f.name);
			return b !== "." && b.startsWith(".");
		},
	})) {
		if (entry.isFile()) {
			yield `${entry.parentPath}/${entry.name}`;
		}
	}
}
