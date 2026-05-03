export type DocumentHeader = {
	headerPrefix: string;
	titleString: string;
};

type NormalizedDocumentMetadata = {
	title: string | null;
	aliases: string[];
	tags: string[];
};

function normalizeTitle(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const title = value.trim();
	return title ? title : null;
}

function normalizeStringList(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value.flatMap((item) => {
		if (typeof item !== "string") return [];
		const normalized = item.trim();
		return normalized ? [normalized] : [];
	});
}

function normalizeDocumentMetadata(
	attributes: Record<string, unknown> | null | undefined,
): NormalizedDocumentMetadata | null {
	if (!attributes) return null;
	return {
		title: normalizeTitle(attributes.title),
		aliases: normalizeStringList(attributes.aliases),
		tags: normalizeStringList(attributes.tags),
	};
}

/**
 * Pure function: derive header text and title string from file path + frontmatter attributes.
 */
export function buildDocumentHeader(
	basename: string,
	parentDir: string,
	attributes: Record<string, unknown> | null | undefined,
): DocumentHeader {
	const headerLines = [`File: ${basename}`, `Path: ${parentDir}`];
	const metadata = normalizeDocumentMetadata(attributes);
	if (metadata) {
		if (metadata.title) headerLines.push(`Title: ${metadata.title}`);
		if (metadata.aliases.length > 0)
			headerLines.push(`Aliases: ${metadata.aliases.join(", ")}`);
		if (metadata.tags.length > 0)
			headerLines.push(`Tags: ${metadata.tags.join(", ")}`);
	}
	const headerPrefix = headerLines.join("\n");

	const titleParts: string[] = [basename];
	if (metadata) {
		if (metadata.title && metadata.title !== basename)
			titleParts.push(metadata.title);
		if (metadata.aliases.length > 0)
			titleParts.push(`aliases: ${metadata.aliases.join(", ")}`);
		if (metadata.tags.length > 0)
			titleParts.push(`tags: ${metadata.tags.join(", ")}`);
	}
	const titleString = titleParts.join("; ");

	return { headerPrefix, titleString };
}
