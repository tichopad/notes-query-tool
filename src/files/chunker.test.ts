import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { chunkMarkdown } from "./chunker.ts";

describe("chunkMarkdown", () => {
	test("empty string → []", () => {
		assert.deepEqual(chunkMarkdown("", 100), []);
	});

	test("whitespace only → []", () => {
		assert.deepEqual(chunkMarkdown("   \n\n  \n", 100), []);
	});

	test("short doc under limit → single chunk", () => {
		const md = "Hello world.";
		const out = chunkMarkdown(md, 100);
		assert.equal(out.length, 1);
		assert.ok(out[0]?.text.includes("Hello world."));
		assert.ok((out[0]?.text.length ?? 0) <= 100);
	});

	test("two h2 sections, combined fit → greedy merged", () => {
		const md = "## A\n\nalpha\n\n## B\n\nbeta\n";
		const out = chunkMarkdown(md, 500);
		assert.equal(out.length, 1);
		// Exact merged structure: no breadcrumb prefix, bodies joined with "\n\n"
		assert.equal(out[0]?.text, "## A\n\nalpha\n\n## B\n\nbeta");
	});

	test("list token: fits as single chunk, structure preserved", () => {
		const md = "## H\n\n- item one\n- item two\n- item three\n";
		const out = chunkMarkdown(md, 500);
		assert.equal(out.length, 1);
		assert.equal(out[0]?.text, "## H\n\n- item one\n- item two\n- item three");
		assert.deepEqual(out[0]?.breadcrumb, []);
	});

	test("table token: fits as single chunk, structure preserved", () => {
		const md =
			"## H\n\n| Col A | Col B |\n| ----- | ----- |\n| r1a   | r1b   |\n| r2a   | r2b   |\n";
		const out = chunkMarkdown(md, 500);
		assert.equal(out.length, 1);
		assert.equal(
			out[0]?.text,
			"## H\n\n| Col A | Col B |\n| ----- | ----- |\n| r1a   | r1b   |\n| r2a   | r2b   |",
		);
		assert.deepEqual(out[0]?.breadcrumb, []);
	});

	test("two h2 sections, combined too big but each fits → two chunks with their headers", () => {
		const a = "x".repeat(40);
		const b = "y".repeat(40);
		const md = `## A\n\n${a}\n\n## B\n\n${b}\n`;
		const out = chunkMarkdown(md, 60);
		assert.equal(out.length, 2);
		assert.ok(out[0]?.text.includes("## A"));
		assert.ok(out[0]?.text.includes(a));
		assert.ok(out[1]?.text.includes("## B"));
		assert.ok(out[1]?.text.includes(b));
		for (const c of out)
			assert.ok(c.text.length <= 60, `${c.text.length} <= 60`);
	});

	test("h1 with two h2 children, whole too big → recurse; breadcrumb includes h1", () => {
		const a = "a".repeat(50);
		const b = "b".repeat(50);
		const md = `# Top\n\n## One\n\n${a}\n\n## Two\n\n${b}\n`;
		const out = chunkMarkdown(md, 80);
		assert.ok(out.length >= 2, `${out.length} >= 2`);
		for (const c of out) {
			assert.ok(c.text.length <= 80, `${c.text.length} <= 80`);
			assert.ok(c.breadcrumb.includes("# Top"));
			// text must NOT contain breadcrumb prefix
			assert.equal(c.text.startsWith("# Top"), false);
		}
		assert.equal(
			out.some((c) => c.text.includes("## One")),
			true,
		);
		assert.equal(
			out.some((c) => c.text.includes("## Two")),
			true,
		);
	});

	test("long paragraph under single header → sentence split, breadcrumb on each", () => {
		const header = "## H";
		const sentences = Array.from(
			{ length: 20 },
			(_, i) => `Sentence number ${i} goes here.`,
		).join(" ");
		const md = `${header}\n\n${sentences}\n`;
		const out = chunkMarkdown(md, 120);
		assert.ok(out.length > 1, `${out.length} > 1`);
		for (const c of out) {
			assert.ok(c.text.length <= 120, `${c.text.length} <= 120`);
			assert.ok(c.breadcrumb.includes("## H"));
			// text must NOT contain breadcrumb
			assert.equal(c.text.startsWith("## H"), false);
		}
	});

	test("single sentence longer than limit → word split", () => {
		const words = Array.from({ length: 50 }, (_, i) => `word${i}`).join(" ");
		const md = `${words}`;
		const out = chunkMarkdown(md, 40);
		assert.ok(out.length > 1, `${out.length} > 1`);
		for (const c of out)
			assert.ok(c.text.length <= 40, `${c.text.length} <= 40`);
		const joined = out.map((c) => c.text).join(" ");
		assert.ok(joined.includes("word0"));
		assert.ok(joined.includes("word49"));
	});

	test("single word longer than limit → hard char split", () => {
		const md = "x".repeat(200);
		const out = chunkMarkdown(md, 30);
		assert.ok(out.length > 1, `${out.length} > 1`);
		for (const c of out)
			assert.ok(c.text.length <= 30, `${c.text.length} <= 30`);
		assert.ok(
			out
				.map((c) => c.text)
				.join("")
				.replaceAll("\n", "")
				.includes("x".repeat(200)),
		);
	});

	test("fenced code block treated atomic when fits", () => {
		const md = "## H\n\n```ts\nconst x = 1;\n```\n";
		const out = chunkMarkdown(md, 200);
		assert.equal(out.length, 1);
		assert.ok(out[0]?.text.includes("```ts"));
		assert.ok(out[0]?.text.includes("const x = 1;"));
	});

	test("oversize fenced code hard-split (no fence repair)", () => {
		const body = "a".repeat(300);
		const md = `## H\n\n\`\`\`\n${body}\n\`\`\`\n`;
		const out = chunkMarkdown(md, 80);
		assert.ok(out.length > 1, `${out.length} > 1`);
		for (const c of out)
			assert.ok(c.text.length <= 80, `${c.text.length} <= 80`);
	});

	test("breadcrumb correctness through 3 levels", () => {
		const body = "c".repeat(200);
		const md = `# L1\n\n## L2\n\n### L3\n\n${body}\n`;
		const out = chunkMarkdown(md, 100);
		assert.ok(out.length > 0, `${out.length} > 0`);
		for (const c of out) {
			assert.ok(c.text.length <= 100, `${c.text.length} <= 100`);
			// nearest ancestor is L3
			assert.equal(c.breadcrumb[c.breadcrumb.length - 1], "### L3");
			// text must NOT contain any breadcrumb prefix
			for (const b of c.breadcrumb) {
				assert.equal(c.text.startsWith(b), false);
			}
		}
	});

	test("every chunk .text.length <= limit (fuzz-ish)", () => {
		const md =
			"# A\n\n" +
			"para one is here. ".repeat(10) +
			"\n\n## B\n\n" +
			"another paragraph with many sentences. ".repeat(20) +
			"\n\n### C\n\n" +
			"word ".repeat(100);
		for (const limit of [20, 50, 100, 250]) {
			const out = chunkMarkdown(md, limit);
			for (const c of out) {
				assert.ok(c.text.length <= limit, `${c.text.length} <= ${limit}`);
			}
		}
	});

	test("offsets map back into source for body", () => {
		const md = "## H\n\nHello body text here.\n";
		const out = chunkMarkdown(md, 200);
		assert.equal(out.length, 1);
		const c = out[0];
		if (!c) throw new Error("expected chunk");
		const slice = md.slice(c.startOffset, c.endOffset);
		assert.ok(slice.includes("Hello body text here."));
	});

	test("offset roundtrip after sentence split", () => {
		// Each sentence becomes its own chunk due to small limit.
		const sentences = Array.from(
			{ length: 5 },
			(_, i) => `Sentence ${i} ends here.`,
		).join(" ");
		const md = `## H\n\n${sentences}\n`;
		const out = chunkMarkdown(md, 60);
		assert.ok(out.length > 1, `${out.length} > 1`);
		for (const c of out) {
			const slice = md.slice(c.startOffset, c.endOffset);
			// text no longer contains breadcrumb prefix, so use text directly as body
			const bodyText = c.text;
			for (const word of bodyText.trim().split(/\s+/).filter(Boolean)) {
				assert.ok(slice.includes(word));
			}
		}
	});

	test("offset roundtrip after word split", () => {
		const words = Array.from({ length: 20 }, (_, i) => `word${i}`).join(" ");
		const md = `${words}\n`;
		const out = chunkMarkdown(md, 30);
		assert.ok(out.length > 1, `${out.length} > 1`);
		for (const c of out) {
			const slice = md.slice(c.startOffset, c.endOffset);
			for (const word of c.text.trim().split(/\s+/).filter(Boolean)) {
				assert.ok(slice.includes(word));
			}
		}
	});

	test("limit=1 boundary: no throw or infinite loop", () => {
		const md = "Hello world.";
		// limit=1 is tiny; splitWordsThenChars guard must handle it
		assert.doesNotThrow(() => chunkMarkdown(md, 1));
		const out = chunkMarkdown(md, 1);
		// each chunk must respect limit
		for (const c of out) assert.ok(c.text.length <= 1, `${c.text.length} <= 1`);
		// all chars present across chunks
		assert.equal(out.map((c) => c.text).join(""), "Hello world.");
	});

	test("preamble before first heading: headingless section produced", () => {
		const md = "intro\n\n## H\n\nbody\n";
		const out = chunkMarkdown(md, 500);
		// Combined or split — intro text must appear in some chunk
		const allText = out.map((c) => c.text).join("\n");
		assert.ok(allText.includes("intro"));
		assert.ok(allText.includes("body"));
		// Preamble chunk has no heading in breadcrumb
		const introCh = out.find((c) => c.text.includes("intro"));
		assert.notEqual(introCh, undefined);
	});

	test("H1→H3 gap (no H2): groupByShallowest recurses correctly", () => {
		const body = "d".repeat(30);
		const md = `# Top\n\n### Deep\n\n${body}\n`;
		const out = chunkMarkdown(md, 200);
		assert.ok(out.length > 0, `${out.length} > 0`);
		const allText = out.map((c) => c.text).join("\n");
		assert.ok(allText.includes("# Top"));
		assert.ok(allText.includes("### Deep"));
		assert.ok(allText.includes(body));
		for (const c of out)
			assert.ok(c.text.length <= 200, `${c.text.length} <= 200`);
	});
});
