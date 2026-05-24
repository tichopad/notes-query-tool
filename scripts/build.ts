import { chmod, cp, rm } from "node:fs/promises";
import { build } from "esbuild";
import packageJson from "../package.json" with { type: "json" };

// Clean dist/
await rm("dist", { recursive: true, force: true });

const runtimeDependencies = packageJson.dependencies
	? Object.keys(packageJson.dependencies)
	: [];
const transitiveRuntimeNativeDependencies = [
	"onnxruntime-node",
	"sharp",
	"protobufjs",
];

await build({
	entryPoints: ["src/main.ts"],
	bundle: true,
	platform: "node",
	target: "node24",
	format: "esm",
	outfile: "dist/main.js",
	minify: true,
	sourcemap: true,
	sourcesContent: false,
	treeShaking: true,
	banner: {
		js: "#!/usr/bin/env node",
	},
	// Resolve migration files relative to dist/main.js at runtime
	define: {
		MIGRATIONS_RELATIVE_PATH: JSON.stringify("./drizzle"),
	},
	// External: packages with native binaries that can't be bundled
	external: [...runtimeDependencies, ...transitiveRuntimeNativeDependencies],
});

await chmod("dist/main.js", 0o755);

// Copy migration SQL files so they're resolvable at runtime
await cp("drizzle", "dist/drizzle", { recursive: true });

console.log("Build complete: dist/main.js");
