const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

interface FrontmatterResult {
	attributes: Record<string, unknown> | null;
	body: string;
}

/**
 * Extract YAML frontmatter from markdown content.
 * Returns parsed attributes and body with frontmatter stripped.
 */
export function extractFrontmatter(content: string): FrontmatterResult {
	const match = content.match(FRONTMATTER_RE);

	if (!match) {
		return { attributes: null, body: content };
	}

	try {
		const parsed = Bun.YAML.parse(match[1] as string);
		const attributes =
			parsed && typeof parsed === "object" && !Array.isArray(parsed)
				? (parsed as Record<string, unknown>)
				: null;
		return { attributes, body: content.slice(match[0].length) };
	} catch {
		return { attributes: null, body: content };
	}
}
