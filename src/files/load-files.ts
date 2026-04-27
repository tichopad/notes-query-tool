import { glob } from "node:fs/promises";

export async function* loadFilesByGlob(
	globPattern: string,
): AsyncIterable<string> {
	yield* glob(globPattern, { exclude: (f) => f.startsWith(".") });
}
