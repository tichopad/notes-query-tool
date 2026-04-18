import { Glob } from "bun";

export function loadFilesByGlob(globPattern: string): AsyncIterable<string> {
	const glob = new Glob(globPattern);

	return glob.scan({ onlyFiles: true, dot: false, absolute: false });
}
