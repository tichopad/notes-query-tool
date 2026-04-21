type ExistingFileState = {
	contentHash: string;
	hasStoredChunksWithEmbeddings: boolean;
} | null;

type LoadDecision = { action: "skip" } | { action: "process" };

export function decideFileProcessing(
	nextContentHash: string,
	existing: ExistingFileState,
): LoadDecision {
	if (existing === null) return { action: "process" };
	if (existing.contentHash !== nextContentHash) return { action: "process" };
	if (!existing.hasStoredChunksWithEmbeddings) return { action: "process" };
	return { action: "skip" };
}
