import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { buildDocumentHeader } from "./build-document-header.ts";

describe("buildDocumentHeader", () => {
	test("no attributes", () => {
		const { headerPrefix, titleString } = buildDocumentHeader(
			"my-note",
			"folder",
			null,
		);
		assert.equal(headerPrefix, "File: my-note\nPath: folder");
		assert.equal(titleString, "my-note");
	});

	test("empty attributes object", () => {
		const { headerPrefix, titleString } = buildDocumentHeader(
			"my-note",
			"folder",
			{},
		);
		assert.equal(headerPrefix, "File: my-note\nPath: folder");
		assert.equal(titleString, "my-note");
	});

	test("title different from basename", () => {
		const { headerPrefix, titleString } = buildDocumentHeader(
			"my-note",
			"folder",
			{ title: "My Note" },
		);
		assert.equal(headerPrefix, "File: my-note\nPath: folder\nTitle: My Note");
		assert.equal(titleString, "my-note; My Note");
	});

	test("title same as basename not duplicated in titleString", () => {
		const { headerPrefix, titleString } = buildDocumentHeader(
			"my-note",
			"folder",
			{ title: "my-note" },
		);
		assert.equal(headerPrefix, "File: my-note\nPath: folder\nTitle: my-note");
		assert.equal(titleString, "my-note");
	});

	test("whitespace-only title ignored", () => {
		const { headerPrefix, titleString } = buildDocumentHeader(
			"my-note",
			"folder",
			{ title: "   " },
		);
		assert.equal(headerPrefix, "File: my-note\nPath: folder");
		assert.equal(titleString, "my-note");
	});

	test("aliases array", () => {
		const { headerPrefix, titleString } = buildDocumentHeader("note", "dir", {
			aliases: ["a", "b"],
		});
		assert.ok(headerPrefix.includes("Aliases: a, b"));
		assert.ok(titleString.includes("aliases: a, b"));
	});

	test("empty aliases not included", () => {
		const { headerPrefix, titleString } = buildDocumentHeader("note", "dir", {
			aliases: [],
		});
		assert.ok(!headerPrefix.includes("Aliases"));
		assert.ok(!titleString.includes("aliases"));
	});

	test("tags array", () => {
		const { headerPrefix, titleString } = buildDocumentHeader("note", "dir", {
			tags: ["x", "y"],
		});
		assert.ok(headerPrefix.includes("Tags: x, y"));
		assert.ok(titleString.includes("tags: x, y"));
	});

	test("mixed-type aliases and tags normalized", () => {
		const { headerPrefix, titleString } = buildDocumentHeader("note", "dir", {
			aliases: [" a ", 1, "", "  ", "b"],
			tags: [null, " x ", false, "", "y", {}],
		});
		assert.equal(
			headerPrefix,
			"File: note\nPath: dir\nAliases: a, b\nTags: x, y",
		);
		assert.equal(titleString, "note; aliases: a, b; tags: x, y");
	});

	test("all fields present", () => {
		const { headerPrefix, titleString } = buildDocumentHeader("note", "dir", {
			title: "Full Note",
			aliases: ["n"],
			tags: ["t"],
		});
		assert.equal(
			headerPrefix,
			"File: note\nPath: dir\nTitle: Full Note\nAliases: n\nTags: t",
		);
		assert.equal(titleString, "note; Full Note; aliases: n; tags: t");
	});
});
