import { Glob } from "bun";

export function loadFiles(globPattern: string): AsyncIterable<string> {
	const glob = new Glob(globPattern);

	return glob.scan({ onlyFiles: true, dot: false, absolute: true });
}
