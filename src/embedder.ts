import {
	type FeatureExtractionPipeline,
	pipeline,
} from "@huggingface/transformers";

// export const MODEL_ID = "onnx-community/Qwen3-Embedding-0.6B-ONNX";
export const MODEL_ID = "onnx-community/embeddinggemma-300m-ONNX";
export const MODEL_DTYPE = "fp32";
export const EMBEDDING_DIMS = 768;

/**
 * Loads the feature-extraction pipeline on the given device.
 * @param device - Inference backend to use.
 * @returns Loaded HuggingFace feature-extraction pipeline.
 */
async function createEmbedder(device: "webgpu" | "cpu") {
	return await pipeline("feature-extraction", MODEL_ID, {
		device,
		dtype: MODEL_DTYPE,
	});
}

/**
 * Converts raw model output to a number array, returning empty array if any value is non-finite.
 * @param data - Raw float buffer from model output.
 * @returns Validated embedding vector, or `[]` if data contains NaN/Infinity.
 */
function extractVector(data: ArrayLike<number>): number[] {
	const vector = Array.from(data);
	if (vector.some((v) => !Number.isFinite(v))) {
		return [];
	}
	return vector;
}

const QUERY_PREFIX = "task: search result | query: ";
const DOC_PREFIX_PREFIX = "title: ";
const DOC_PREFIX_INFIX = " | text: ";
const DEFAULT_TITLE = "none";

export interface Embedder {
	embedQuery(text: string): Promise<number[]>;
	embedDocument(body: string, title?: string | null): Promise<number[]>;
}

/**
 * Initialises the embedding model, preferring WebGPU with automatic CPU fallback.
 * Returns an `Embedder` object with `embedQuery` and `embedDocument` methods using
 * mean-pooled, normalised features and EmbeddingGemma task prefixes.
 * If WebGPU produces NaN values at runtime, it transparently re-initialises on CPU and retries.
 * @returns Embedder object with query and document embedding functions.
 * @throws {Error} If the CPU backend also produces non-finite values.
 */
export async function initEmbedder(): Promise<Embedder> {
	let embed: FeatureExtractionPipeline;
	let device: "webgpu" | "cpu" = "webgpu";

	try {
		embed = await createEmbedder("webgpu");
	} catch {
		console.warn("WebGPU unavailable, using CPU.");
		device = "cpu";
		embed = await createEmbedder("cpu");
	}

	async function getEmbedding(text: string): Promise<number[]> {
		const result = await embed(text, {
			pooling: "mean",
			normalize: true,
		});
		const vector = extractVector(result.data as Float32Array);
		if (vector.length > 0) {
			return vector;
		}

		// WebGPU produced NaN (GPU device lost). Fall back to CPU.
		if (device === "webgpu") {
			console.warn(
				"WebGPU produced invalid embeddings, falling back to CPU...",
			);
			device = "cpu";
			embed = await createEmbedder("cpu");
			return getEmbedding(text);
		}

		throw new Error("Embedding model produced non-finite values");
	}

	return {
		embedQuery(text: string): Promise<number[]> {
			return getEmbedding(QUERY_PREFIX + text);
		},
		embedDocument(body: string, title?: string | null): Promise<number[]> {
			const t = title?.trim() || DEFAULT_TITLE;
			return getEmbedding(DOC_PREFIX_PREFIX + t + DOC_PREFIX_INFIX + body);
		},
	};
}
