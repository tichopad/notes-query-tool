import {
	type FeatureExtractionPipeline,
	pipeline,
} from "@huggingface/transformers";

export const MODEL_ID = "onnx-community/Qwen3-Embedding-0.6B-ONNX";
export const MODEL_DTYPE = "q4f16";
export const EMBEDDING_DIMS = 1024;

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

/**
 * Initialises the embedding model, preferring WebGPU with automatic CPU fallback.
 * Returns a `getEmbedding` function that embeds a single text string using
 * mean-pooled, normalised features. If WebGPU produces NaN values at runtime,
 * it transparently re-initialises on CPU and retries.
 * @returns Async function that maps a text string to its embedding vector.
 * @throws {Error} If the CPU backend also produces non-finite values.
 */
export async function initEmbedder(): Promise<
	(text: string) => Promise<number[]>
> {
	let embed: FeatureExtractionPipeline;
	let device: "webgpu" | "cpu" = "webgpu";

	try {
		embed = await createEmbedder("webgpu");
	} catch {
		console.warn("WebGPU unavailable, using CPU.");
		device = "cpu";
		embed = await createEmbedder("cpu");
	}

	return async function getEmbedding(text: string): Promise<number[]> {
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
	};
}
