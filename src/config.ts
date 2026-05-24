import { homedir } from "node:os";
import { join } from "node:path";
import type { DataType } from "@huggingface/transformers";

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

/** HuggingFace model identifier used for embedding. */
export const MODEL_ID: string = "onnx-community/embeddinggemma-300m-ONNX";
// export const MODEL_ID = "onnx-community/Qwen3-Embedding-0.6B-ONNX";

/** Quantisation dtype passed to the transformers pipeline. */
export const MODEL_DTYPE: DataType | Record<string, DataType> = "fp32";

/**
 * Output vector dimension for the active model.
 * Must stay in sync with MODEL_ID — changing the model requires a schema
 * migration to update the vector column dimension.
 */
export const EMBEDDING_DIMS: number = 768;

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------

function getDataDir(): string {
	const xdg = process.env.XDG_DATA_HOME;
	const base = xdg && xdg.length > 0 ? xdg : join(homedir(), ".local", "share");
	return `${join(base, "nqt")}/`;
}

/** PGLite data directory (XDG_DATA_HOME/nqt/ or ~/.local/share/nqt/). */
export const DB_DATA_DIR: string = getDataDir();

// ---------------------------------------------------------------------------
// Chunking
// ---------------------------------------------------------------------------

/** Maximum characters per chunk produced by the Markdown chunker. */
export const CHUNK_LIMIT_CHARS: number = 2000;

// ---------------------------------------------------------------------------
// Query — retrieval limits
// ---------------------------------------------------------------------------

/** Maximum number of candidates fetched from the vector index. */
export const VECTOR_LIMIT: number = 30;

/** Maximum number of candidates fetched via full-text search. */
export const FTS_LIMIT: number = 20;

/** Maximum number of candidates fetched via trigram search. */
export const TRIGRAM_LIMIT: number = 20;

// ---------------------------------------------------------------------------
// Query — score fusion weights
// ---------------------------------------------------------------------------

/** Contribution of normalised vector similarity to the fused score. */
export const VECTOR_WEIGHT: number = 0.3;

/** Contribution of normalised FTS rank to the fused score. */
export const FTS_WEIGHT: number = 0.4;

/** Contribution of normalised trigram score to the fused score. */
export const TRIGRAM_WEIGHT: number = 0.3;

// ---------------------------------------------------------------------------
// Query — trigram
// ---------------------------------------------------------------------------

/** Minimum trigram similarity required for a chunk to qualify. */
export const TRIGRAM_THRESHOLD: number = 0.3;

// ---------------------------------------------------------------------------
// Query — wikilink re-ranking
// ---------------------------------------------------------------------------

/** Score boost applied to files referenced by a top-source chunk. */
export const LINK_BOOST: number = 0.2;

/** Maximum cumulative boost a file can receive from wikilinks. */
export const LINK_BOOST_CAP: number = 0.4;

/** Number of top-scoring source chunks examined for wikilinks. */
export const LINK_SOURCE_TOP_N: number = 10;
