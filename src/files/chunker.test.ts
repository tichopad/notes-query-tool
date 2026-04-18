import { describe, expect, test } from "bun:test";
import { chunkMarkdown } from "./chunker.ts";

describe("chunkMarkdown", () => {
	test("empty string → []", () => {
		expect(chunkMarkdown("", 100)).toEqual([]);
	});

	test("whitespace only → []", () => {
		expect(chunkMarkdown("   \n\n  \n", 100)).toEqual([]);
	});

	test("short doc under limit → single chunk", () => {
		const md = "Hello world.";
		const out = chunkMarkdown(md, 100);
		expect(out.length).toBe(1);
		expect(out[0]?.text).toContain("Hello world.");
		expect(out[0]?.text.length).toBeLessThanOrEqual(100);
	});

	test("two h2 sections, combined fit → greedy merged", () => {
		const md = "## A\n\nalpha\n\n## B\n\nbeta\n";
		const out = chunkMarkdown(md, 500);
		expect(out.length).toBe(1);
		// Exact merged structure: no breadcrumb prefix, bodies joined with "\n\n"
		expect(out[0]?.text).toBe("## A\n\nalpha\n\n## B\n\nbeta");
	});

	test("list token: fits as single chunk, structure preserved", () => {
		const md = "## H\n\n- item one\n- item two\n- item three\n";
		const out = chunkMarkdown(md, 500);
		expect(out.length).toBe(1);
		expect(out[0]?.text).toBe("## H\n\n- item one\n- item two\n- item three");
		expect(out[0]?.breadcrumb).toEqual([]);
	});

	test("table token: fits as single chunk, structure preserved", () => {
		const md =
			"## H\n\n| Col A | Col B |\n| ----- | ----- |\n| r1a   | r1b   |\n| r2a   | r2b   |\n";
		const out = chunkMarkdown(md, 500);
		expect(out.length).toBe(1);
		expect(out[0]?.text).toBe(
			"## H\n\n| Col A | Col B |\n| ----- | ----- |\n| r1a   | r1b   |\n| r2a   | r2b   |",
		);
		expect(out[0]?.breadcrumb).toEqual([]);
	});

	test("two h2 sections, combined too big but each fits → two chunks with their headers", () => {
		const a = "x".repeat(40);
		const b = "y".repeat(40);
		const md = `## A\n\n${a}\n\n## B\n\n${b}\n`;
		const out = chunkMarkdown(md, 60);
		expect(out.length).toBe(2);
		expect(out[0]?.text).toContain("## A");
		expect(out[0]?.text).toContain(a);
		expect(out[1]?.text).toContain("## B");
		expect(out[1]?.text).toContain(b);
		for (const c of out) expect(c.text.length).toBeLessThanOrEqual(60);
	});

	test("h1 with two h2 children, whole too big → recurse; breadcrumb includes h1", () => {
		const a = "a".repeat(50);
		const b = "b".repeat(50);
		const md = `# Top\n\n## One\n\n${a}\n\n## Two\n\n${b}\n`;
		const out = chunkMarkdown(md, 80);
		expect(out.length).toBeGreaterThanOrEqual(2);
		for (const c of out) {
			expect(c.text.length).toBeLessThanOrEqual(80);
			expect(c.breadcrumb).toContain("# Top");
			// text must NOT contain breadcrumb prefix
			expect(c.text.startsWith("# Top")).toBe(false);
		}
		expect(out.some((c) => c.text.includes("## One"))).toBe(true);
		expect(out.some((c) => c.text.includes("## Two"))).toBe(true);
	});

	test("long paragraph under single header → sentence split, breadcrumb on each", () => {
		const header = "## H";
		const sentences = Array.from(
			{ length: 20 },
			(_, i) => `Sentence number ${i} goes here.`,
		).join(" ");
		const md = `${header}\n\n${sentences}\n`;
		const out = chunkMarkdown(md, 120);
		expect(out.length).toBeGreaterThan(1);
		for (const c of out) {
			expect(c.text.length).toBeLessThanOrEqual(120);
			expect(c.breadcrumb).toContain("## H");
			// text must NOT contain breadcrumb
			expect(c.text.startsWith("## H")).toBe(false);
		}
	});

	test("single sentence longer than limit → word split", () => {
		const words = Array.from({ length: 50 }, (_, i) => `word${i}`).join(" ");
		const md = `${words}`;
		const out = chunkMarkdown(md, 40);
		expect(out.length).toBeGreaterThan(1);
		for (const c of out) expect(c.text.length).toBeLessThanOrEqual(40);
		const joined = out.map((c) => c.text).join(" ");
		expect(joined).toContain("word0");
		expect(joined).toContain("word49");
	});

	test("single word longer than limit → hard char split", () => {
		const md = "x".repeat(200);
		const out = chunkMarkdown(md, 30);
		expect(out.length).toBeGreaterThan(1);
		for (const c of out) expect(c.text.length).toBeLessThanOrEqual(30);
		expect(
			out
				.map((c) => c.text)
				.join("")
				.replaceAll("\n", ""),
		).toContain("x".repeat(200));
	});

	test("fenced code block treated atomic when fits", () => {
		const md = "## H\n\n```ts\nconst x = 1;\n```\n";
		const out = chunkMarkdown(md, 200);
		expect(out.length).toBe(1);
		expect(out[0]?.text).toContain("```ts");
		expect(out[0]?.text).toContain("const x = 1;");
	});

	test("oversize fenced code hard-split (no fence repair)", () => {
		const body = "a".repeat(300);
		const md = `## H\n\n\`\`\`\n${body}\n\`\`\`\n`;
		const out = chunkMarkdown(md, 80);
		expect(out.length).toBeGreaterThan(1);
		for (const c of out) expect(c.text.length).toBeLessThanOrEqual(80);
	});

	test("breadcrumb correctness through 3 levels", () => {
		const body = "c".repeat(200);
		const md = `# L1\n\n## L2\n\n### L3\n\n${body}\n`;
		const out = chunkMarkdown(md, 100);
		expect(out.length).toBeGreaterThan(0);
		for (const c of out) {
			expect(c.text.length).toBeLessThanOrEqual(100);
			// nearest ancestor is L3
			expect(c.breadcrumb[c.breadcrumb.length - 1]).toBe("### L3");
			// text must NOT contain any breadcrumb prefix
			for (const b of c.breadcrumb) {
				expect(c.text.startsWith(b)).toBe(false);
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
				expect(c.text.length).toBeLessThanOrEqual(limit);
			}
		}
	});

	test("offsets map back into source for body", () => {
		const md = "## H\n\nHello body text here.\n";
		const out = chunkMarkdown(md, 200);
		expect(out.length).toBe(1);
		const c = out[0];
		if (!c) throw new Error("expected chunk");
		const slice = md.slice(c.startOffset, c.endOffset);
		expect(slice).toContain("Hello body text here.");
	});

	test("offset roundtrip after sentence split", () => {
		// Each sentence becomes its own chunk due to small limit.
		const sentences = Array.from(
			{ length: 5 },
			(_, i) => `Sentence ${i} ends here.`,
		).join(" ");
		const md = `## H\n\n${sentences}\n`;
		const out = chunkMarkdown(md, 60);
		expect(out.length).toBeGreaterThan(1);
		for (const c of out) {
			const slice = md.slice(c.startOffset, c.endOffset);
			// text no longer contains breadcrumb prefix, so use text directly as body
			const bodyText = c.text;
			for (const word of bodyText.trim().split(/\s+/).filter(Boolean)) {
				expect(slice).toContain(word);
			}
		}
	});

	test("offset roundtrip after word split", () => {
		const words = Array.from({ length: 20 }, (_, i) => `word${i}`).join(" ");
		const md = `${words}\n`;
		const out = chunkMarkdown(md, 30);
		expect(out.length).toBeGreaterThan(1);
		for (const c of out) {
			const slice = md.slice(c.startOffset, c.endOffset);
			for (const word of c.text.trim().split(/\s+/).filter(Boolean)) {
				expect(slice).toContain(word);
			}
		}
	});

	test("limit=1 boundary: no throw or infinite loop", () => {
		const md = "Hello world.";
		// limit=1 is tiny; splitWordsThenChars guard must handle it
		expect(() => chunkMarkdown(md, 1)).not.toThrow();
		const out = chunkMarkdown(md, 1);
		// each chunk must respect limit
		for (const c of out) expect(c.text.length).toBeLessThanOrEqual(1);
		// all chars present across chunks
		expect(out.map((c) => c.text).join("")).toBe("Hello world.");
	});

	test("preamble before first heading: headingless section produced", () => {
		const md = "intro\n\n## H\n\nbody\n";
		const out = chunkMarkdown(md, 500);
		// Combined or split — intro text must appear in some chunk
		const allText = out.map((c) => c.text).join("\n");
		expect(allText).toContain("intro");
		expect(allText).toContain("body");
		// Preamble chunk has no heading in breadcrumb
		const introCh = out.find((c) => c.text.includes("intro"));
		expect(introCh).toBeDefined();
	});

	test("H1→H3 gap (no H2): groupByShallowest recurses correctly", () => {
		const body = "d".repeat(30);
		const md = `# Top\n\n### Deep\n\n${body}\n`;
		const out = chunkMarkdown(md, 200);
		expect(out.length).toBeGreaterThan(0);
		const allText = out.map((c) => c.text).join("\n");
		expect(allText).toContain("# Top");
		expect(allText).toContain("### Deep");
		expect(allText).toContain(body);
		for (const c of out) expect(c.text.length).toBeLessThanOrEqual(200);
	});
});
