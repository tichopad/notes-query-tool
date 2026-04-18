// marked@18 API surface used: marked.lexer(src) → Token[]; Token and Tokens.Heading types from "marked".
// marked.lexer returns a flat TokensList (Token[]). Each token has a `raw` string (original source text).
// Tokens.Heading has `depth` (1–6) and `text`. No Parser or Renderer used — lexer only.
import { marked, type Token, type Tokens } from "marked";

export interface Chunk {
	text: string;
	breadcrumb: string[];
	startOffset: number;
	endOffset: number;
}

// Token with computed source offsets.
interface PosToken {
	token: Token;
	start: number;
	end: number;
	raw: string;
}

// Section = optional heading + body tokens (all deeper-level content).
interface Section {
	heading: PosToken | null; // null for pre-heading root
	level: number; // 0 = root, 1..6 = h1..h6
	body: PosToken[]; // flat list of all tokens after the heading: non-heading content AND deeper headings in document order.
	start: number; // offset of heading (or first body token) in src
	end: number; // end offset of last body token
}

const MAX_HEADER_LEVEL = 6;

export function chunkMarkdown(md: string, limit: number): Chunk[] {
	if (limit <= 0) throw new Error("limit must be > 0");
	if (md.length === 0) return [];
	if (md.trim().length === 0) return [];

	const pos = lexWithOffsets(md);
	if (pos.length === 0) return [];

	const root = buildRootSection(pos);
	const chunks = renderSection(root, [], limit);
	return greedyMerge(chunks, limit);
}

function lexWithOffsets(md: string): PosToken[] {
	const tokens = marked.lexer(md);
	const out: PosToken[] = [];
	let cursor = 0;
	for (const t of tokens) {
		const raw = (t as { raw?: string }).raw ?? "";
		const start = cursor;
		const end = cursor + raw.length;
		out.push({ token: t, start, end, raw });
		cursor = end;
	}
	return out;
}

function buildRootSection(tokens: PosToken[]): Section {
	return {
		heading: null,
		level: 0,
		body: tokens,
		start: tokens[0]?.start ?? 0,
		end: tokens[tokens.length - 1]?.end ?? 0,
	};
}

// Group body tokens into subsections split at shallowest heading level present.
// Returns null if no heading present in body.
function groupByShallowestHeading(body: PosToken[]): Section[] | null {
	// MAX_HEADER_LEVEL + 1 acts as sentinel: "no heading seen yet". Any real heading depth (1–6) is smaller.
	let shallowest = MAX_HEADER_LEVEL + 1;
	for (const pt of body) {
		if (isHeading(pt.token)) {
			const lvl = (pt.token as Tokens.Heading).depth;
			if (lvl < shallowest) shallowest = lvl;
		}
	}
	if (shallowest > MAX_HEADER_LEVEL) return null;

	const sections: Section[] = [];
	let current: Section | null = null;
	// Preamble (before first heading at shallowest level) goes into synthetic section with no heading.
	for (const pt of body) {
		if (
			isHeading(pt.token) &&
			(pt.token as Tokens.Heading).depth === shallowest
		) {
			if (current) sections.push(finalizeSection(current));
			current = {
				heading: pt,
				level: shallowest,
				body: [],
				start: pt.start,
				end: pt.end,
			};
		} else {
			if (!current) {
				current = {
					heading: null,
					level: 0,
					body: [],
					start: pt.start,
					end: pt.end,
				};
			}
			current.body.push(pt);
			current.end = pt.end;
		}
	}
	if (current) sections.push(finalizeSection(current));
	return sections;
}

function finalizeSection(s: Section): Section {
	const last = s.body[s.body.length - 1];
	if (last) {
		s.end = last.end;
	} else if (s.heading) {
		s.end = s.heading.end;
	}
	return s;
}

function isHeading(t: Token): boolean {
	return t.type === "heading";
}

function renderSection(
	section: Section,
	ancestors: string[],
	limit: number,
): Chunk[] {
	const headingLine = section.heading ? headingLineOf(section.heading) : null;
	// Ancestors passed to children include this heading; own chunk uses parent ancestors and keeps heading in body.
	const childAncestors = headingLine ? [...ancestors, headingLine] : ancestors;

	// Body offsets
	const bodyStart =
		section.body[0]?.start ?? section.heading?.end ?? section.start;
	const bodyEnd =
		section.body[section.body.length - 1]?.end ??
		section.heading?.end ??
		section.end;

	const bodyText = concatRaw(section.body);
	const ownHeadingPrefix = section.heading ? `${headingLine}\n\n` : "";
	const fullBody = trimTrailingNewlines(ownHeadingPrefix + bodyText);

	const assembled = assemble(ancestors, fullBody, limit);
	if (
		assembled !== null &&
		assembled.text.length <= limit &&
		fullBody.length > 0
	) {
		return [
			{
				text: assembled.text,
				breadcrumb: assembled.breadcrumb,
				startOffset: section.heading ? section.heading.start : bodyStart,
				endOffset: bodyEnd,
			},
		];
	}

	// Too big. Try deeper headings inside body.
	const subs = groupByShallowestHeading(section.body);
	if (subs && subs.length > 0 && subs.some((s) => s.heading !== null)) {
		const out: Chunk[] = [];
		for (const sub of subs) {
			if (sub.heading === null) {
				if (sub.body.some((t) => t.raw.trim().length > 0)) {
					out.push(...splitBody(sub.body, childAncestors, limit));
				}
			} else {
				out.push(...renderSection(sub, childAncestors, limit));
			}
		}
		return out;
	}

	// No deeper headings — fall to block/sentence/word/char. Use childAncestors so heading becomes breadcrumb.
	return splitBody(section.body, childAncestors, limit);
}

function splitBody(
	body: PosToken[],
	ancestors: string[],
	limit: number,
): Chunk[] {
	if (body.length === 0) return [];
	const out: Chunk[] = [];
	for (const pt of body) {
		const trimmedRaw = trimTrailingNewlines(pt.raw);
		if (trimmedRaw.trim().length === 0) continue; // skip space/blank tokens
		const assembled = assemble(ancestors, trimmedRaw, limit);
		if (assembled !== null && assembled.text.length <= limit) {
			out.push({
				text: assembled.text,
				breadcrumb: assembled.breadcrumb,
				startOffset: pt.start,
				endOffset: pt.end,
			});
		} else {
			out.push(...splitOversizeBlock(pt, ancestors, limit));
		}
	}
	return out;
}

function splitOversizeBlock(
	pt: PosToken,
	ancestors: string[],
	limit: number,
): Chunk[] {
	const raw = trimTrailingNewlines(pt.raw);
	// sentence split
	const sentences = splitSentences(raw);
	if (sentences.length > 1) {
		return assembleSlices(sentences, pt.start, ancestors, limit, (remaining) =>
			splitWordsThenChars(
				remaining,
				limit,
				breadcrumbBudgetSize(ancestors, limit),
			),
		);
	}
	// NOTE: single-sentence (or no sentence boundary) path falls through to word/char split.
	// hardSlice inside splitWordsThenChars may cut mid-fence-block when a fenced code block
	// has no whitespace break points within the limit window — output will be syntactically
	// broken Markdown for that chunk. Acceptable: oversized unfenced blocks are pathological input.
	// single sentence — word split
	return assembleSlicesRaw(
		splitWordsThenChars(raw, limit, breadcrumbBudgetSize(ancestors, limit)),
		pt.start,
		ancestors,
		limit,
	);
}

// sentence split preserving indices and trailing whitespace — returns array of { text, offset } where text is substring of raw.
interface Slice {
	text: string;
	offset: number; // offset within raw
}

function splitSentences(raw: string): Slice[] {
	const slices: Slice[] = [];
	const regex = /[^.!?]+[.!?]+(?:\s+|$)/g;
	let lastEnd = 0;
	let m: RegExpExecArray | null;
	// biome-ignore lint/suspicious/noAssignInExpressions: standard regex loop
	while ((m = regex.exec(raw)) !== null) {
		slices.push({ text: m[0], offset: m.index });
		lastEnd = m.index + m[0].length;
	}
	if (lastEnd < raw.length) {
		slices.push({ text: raw.slice(lastEnd), offset: lastEnd });
	}
	return slices.length === 0 ? [{ text: raw, offset: 0 }] : slices;
}

function splitWordsThenChars(
	raw: string,
	limit: number,
	budget: number,
): Slice[] {
	const avail = Math.max(1, limit - budget);
	const slices: Slice[] = [];
	// word boundary first
	const wordRegex = /\S+\s*/g;
	const words: Slice[] = [];
	let m: RegExpExecArray | null;
	// biome-ignore lint/suspicious/noAssignInExpressions: regex loop
	while ((m = wordRegex.exec(raw)) !== null) {
		words.push({ text: m[0], offset: m.index });
	}
	const first = words[0];
	if (!first) return hardSlice(raw, avail, 0);

	let cur = "";
	let curOffset = first.offset;
	for (const w of words) {
		if (w.text.length > avail) {
			if (cur.length > 0) {
				slices.push({ text: cur, offset: curOffset });
				cur = "";
			}
			slices.push(...hardSlice(w.text, avail, w.offset));
			curOffset = w.offset + w.text.length;
			continue;
		}
		if (cur.length + w.text.length > avail) {
			slices.push({ text: cur, offset: curOffset });
			cur = w.text;
			curOffset = w.offset;
		} else {
			if (cur.length === 0) curOffset = w.offset;
			cur += w.text;
		}
	}
	if (cur.length > 0) slices.push({ text: cur, offset: curOffset });
	return slices;
}

function hardSlice(text: string, size: number, baseOffset: number): Slice[] {
	const out: Slice[] = [];
	for (let i = 0; i < text.length; i += size) {
		out.push({ text: text.slice(i, i + size), offset: baseOffset + i });
	}
	return out;
}

function assembleSlices(
	slices: Slice[],
	baseOffset: number,
	ancestors: string[],
	limit: number,
	furtherSplit: (remaining: string) => Slice[],
): Chunk[] {
	const budget = breadcrumbBudgetSize(ancestors, limit);
	const avail = Math.max(1, limit - budget);
	const out: Chunk[] = [];
	let buf = "";
	let bufOffset = slices[0]?.offset ?? 0;
	for (const s of slices) {
		if (s.text.length > avail) {
			if (buf.length > 0) {
				out.push(emit(buf, baseOffset + bufOffset, ancestors, limit));
				buf = "";
			}
			const finer = furtherSplit(s.text);
			for (const f of finer) {
				// Triple offset indirection: baseOffset = token start in source doc;
				// s.offset = sentence start within token raw; f.offset = sub-slice start within sentence.
				out.push(
					emit(f.text, baseOffset + s.offset + f.offset, ancestors, limit),
				);
			}
			continue;
		}
		if (buf.length + s.text.length > avail) {
			out.push(emit(buf, baseOffset + bufOffset, ancestors, limit));
			buf = s.text;
			bufOffset = s.offset;
		} else {
			if (buf.length === 0) bufOffset = s.offset;
			buf += s.text;
		}
	}
	if (buf.length > 0)
		out.push(emit(buf, baseOffset + bufOffset, ancestors, limit));
	return out;
}

function assembleSlicesRaw(
	slices: Slice[],
	baseOffset: number,
	ancestors: string[],
	limit: number,
): Chunk[] {
	const out: Chunk[] = [];
	for (const s of slices) {
		out.push(emit(s.text, baseOffset + s.offset, ancestors, limit));
	}
	return out;
}

function emit(
	body: string,
	startOffset: number,
	ancestors: string[],
	limit: number,
): Chunk {
	const trimmed = trimTrailingNewlines(body);
	const a = assemble(ancestors, trimmed, limit);
	if (!a)
		throw new Error(
			`emit: assemble returned null for body length ${trimmed.length}, limit ${limit}`,
		);
	const { text, breadcrumb } = a;
	if (text.length > limit)
		throw new Error(
			`emit: assembled text length ${text.length} exceeds limit ${limit} — body was not pre-split correctly`,
		);
	return {
		text,
		breadcrumb,
		startOffset,
		endOffset: startOffset + body.length,
	};
}

function assemble(
	ancestors: string[],
	body: string,
	limit: number,
): { text: string; breadcrumb: string[] } | null {
	let a = [...ancestors];
	while (true) {
		if (body.length <= limit) return { text: body, breadcrumb: a };
		// No ancestors left to strip and body still exceeds limit — caller must split body further.
		if (a.length === 0) return null;
		a = a.slice(1);
	}
}

function breadcrumbBudgetSize(ancestors: string[], limit: number): number {
	if (ancestors.length === 0) return 0;
	// assume full breadcrumb used
	const prefix = `${ancestors.join("\n")}\n\n`;
	if (prefix.length >= limit) {
		// will be truncated; worst-case budget is 0 (may emit without breadcrumb)
		return 0;
	}
	return prefix.length;
}

function concatRaw(tokens: PosToken[]): string {
	let s = "";
	for (const t of tokens) s += t.raw;
	return s;
}

function headingLineOf(pt: PosToken): string {
	// raw includes trailing newline(s); strip to single line.
	return pt.raw.replace(/\n+$/, "");
}

function trimTrailingNewlines(s: string): string {
	return s.replace(/\n+$/, "");
}

function greedyMerge(chunks: Chunk[], limit: number): Chunk[] {
	if (chunks.length <= 1) return chunks;
	const out: Chunk[] = [];
	const first = chunks[0];
	if (!first) return chunks;
	let cur: Chunk = first;
	for (let i = 1; i < chunks.length; i++) {
		const next = chunks[i];
		if (!next) continue;
		if (!sameBreadcrumb(cur.breadcrumb, next.breadcrumb)) {
			out.push(cur);
			cur = next;
			continue;
		}
		const mergedBody = `${cur.text}\n\n${next.text}`;
		const prefix =
			cur.breadcrumb.length > 0 ? `${cur.breadcrumb.join("\n")}\n\n` : "";
		if (prefix.length + mergedBody.length <= limit) {
			cur = {
				text: mergedBody,
				breadcrumb: cur.breadcrumb,
				startOffset: cur.startOffset,
				endOffset: next.endOffset,
			};
		} else {
			out.push(cur);
			cur = next;
		}
	}
	out.push(cur);
	return out;
}

function sameBreadcrumb(a: string[], b: string[]): boolean {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
	return true;
}
