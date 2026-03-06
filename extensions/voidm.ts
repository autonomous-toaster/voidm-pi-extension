/**
 * voidm Extension — Persistent memory for AI agents
 * Replaces mmry. Backed by voidm (local-first, hybrid search, graph layer).
 */

import { StringEnum } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionContext, Theme } from "@mariozechner/pi-coding-agent";
import { matchesKey, Text, truncateToWidth } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Memory {
	id: string;
	content: string;
	type: "episodic" | "semantic" | "procedural" | "conceptual" | "contextual";
	scopes: string[];
	tags: string[];
	importance: number;
	created_at: string;
}

interface SuggestedLink {
	id: string;
	score: number;
	memory_type: string;
	content: string;
	hint: string;
}

interface MemoryDetails {
	action: "add" | "search" | "list" | "delete" | "link" | "neighbors" | "pagerank";
	memories: Memory[];
	error?: string;
	message?: string;
}

// ---------------------------------------------------------------------------
// voidm CLI wrapper
// ---------------------------------------------------------------------------

const VOIDM = (() => {
	// $VOIDM_BIN → ~/.local/bin/voidm → voidm (PATH fallback)
	if (process.env.VOIDM_BIN) return process.env.VOIDM_BIN;
	const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
	const local = `${home}/.local/bin/voidm`;
	try { require("node:fs").accessSync(local, require("node:fs").constants.X_OK); return local; } catch {}
	return "voidm";
})();

async function execVoidm(args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
	try {
		const { stdout, stderr } = await execFileAsync(VOIDM, args, {
			maxBuffer: 10 * 1024 * 1024,
		});
		return { stdout, stderr, code: 0 };
	} catch (error: any) {
		// execFile rejects on non-zero exit — extract stdout/stderr from error
		return {
			stdout: error.stdout ?? "",
			stderr: error.stderr ?? "",
			code: error.code ?? 1,
		};
	}
}

function parseJson<T>(raw: string): T | null {
	try {
		return JSON.parse(raw) as T;
	} catch {
		return null;
	}
}

function memoryFromJson(raw: any): Memory {
	return {
		id: raw.id ?? "",
		content: raw.content ?? "",
		type: raw.type ?? "semantic",
		scopes: raw.scopes ?? [],
		tags: raw.tags ?? [],
		importance: raw.importance ?? 5,
		created_at: raw.created_at ?? "",
	};
}

// ---------------------------------------------------------------------------
// Tool parameter schema
// ---------------------------------------------------------------------------

const MemoryParams = Type.Object({
	action: StringEnum(["add", "search", "list", "delete", "link", "neighbors", "pagerank", "cypher"] as const),

	// add
	content: Type.Optional(Type.String({ description: "Memory content (for add)" })),
	type: Type.Optional(
		StringEnum(["episodic", "semantic", "procedural", "conceptual", "contextual"] as const, {
			description: "Memory type (required for add)",
		}),
	),
	scope: Type.Optional(Type.String({ description: "Scope prefix, e.g. work/acme (for add/search/list)" })),
	tags: Type.Optional(Type.String({ description: "Comma-separated tags (for add)" })),
	importance: Type.Optional(Type.Number({ description: "Importance 1-10 (for add, default 5)" })),

	// search
	query: Type.Optional(Type.String({ description: "Search query (for search)" })),
	mode: Type.Optional(
		StringEnum(["hybrid", "semantic", "bm25", "fuzzy", "keyword"] as const, {
			description: "Search mode (for search, default hybrid)",
		}),
	),
	min_score: Type.Optional(Type.Number({ description: "Min score threshold 0-1 for hybrid mode (default 0.3, use 0 to disable)" })),
	limit: Type.Optional(Type.Number({ description: "Max results (for search/list/pagerank)" })),
	// neighbor expansion (for search)
	include_neighbors: Type.Optional(Type.Boolean({ description: "Expand search results with graph neighbors (default false)" })),
	neighbor_depth: Type.Optional(Type.Number({ description: "Max hops for neighbor expansion, default 1, hard cap 3" })),
	neighbor_decay: Type.Optional(Type.Number({ description: "Score decay per hop: neighbor_score = parent_score * decay^depth (default 0.7)" })),
	neighbor_min_score: Type.Optional(Type.Number({ description: "Min score for neighbors to be included (default 0.2)" })),
	neighbor_limit: Type.Optional(Type.Number({ description: "Max total neighbors to append, default = limit" })),
	edge_types: Type.Optional(Type.Array(
		StringEnum(["PART_OF", "SUPPORTS", "DERIVED_FROM", "EXEMPLIFIES", "RELATES_TO", "PRECEDES"] as const),
		{ description: "Edge types to traverse (default: PART_OF, SUPPORTS, DERIVED_FROM, EXEMPLIFIES)" }
	)),

	// delete / neighbors / path
	id: Type.Optional(Type.String({ description: "Memory ID or short prefix (min 4 chars) — for delete/neighbors" })),

	// link / path
	from_id: Type.Optional(Type.String({ description: "Source memory ID or short prefix (for link)" })),
	rel: Type.Optional(
		StringEnum(["SUPPORTS", "CONTRADICTS", "DERIVED_FROM", "PRECEDES", "PART_OF", "EXEMPLIFIES", "INVALIDATES", "RELATES_TO"] as const, {
			description: "Edge type (for link)",
		}),
	),
	to_id: Type.Optional(Type.String({ description: "Target memory ID or short prefix (for link)" })),
	note: Type.Optional(Type.String({ description: "Required note when rel=RELATES_TO" })),

	// neighbors
	depth: Type.Optional(Type.Number({ description: "Traversal depth for neighbors (default 1)" })),

	// cypher
	cypher_query: Type.Optional(Type.String({ description: "Read-only Cypher query (for cypher action). MATCH/WHERE/RETURN/ORDER BY/LIMIT/WITH only. Write clauses are rejected." })),
});

// ---------------------------------------------------------------------------
// TUI: Memory browser
// ---------------------------------------------------------------------------

class MemoryBrowser {
	private memories: Memory[];
	private filtered: Memory[] = [];
	private theme: Theme;
	private onClose: () => void;
	private execVoidm: typeof execVoidm;

	private selectedIndex = 0;
	private currentPage = 0;
	private pageSize = 6;

	private mode: "list" | "search-input" | "search-results" | "detail" = "list";
	private searchQuery = "";
	private deleteConfirm = false;
	private deleteTimer?: ReturnType<typeof setTimeout>;

	private dirty = true;
	private cachedWidth?: number;
	private cachedLines?: string[];

	constructor(memories: Memory[], theme: Theme, onClose: () => void, exec: typeof execVoidm) {
		this.memories = memories;
		this.filtered = memories;
		this.theme = theme;
		this.onClose = onClose;
		this.execVoidm = exec;
	}

	async handleInput(data: string): Promise<void> {
		const th = this.theme;

		// ESC / Ctrl+C: back or close
		if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) {
			if (this.deleteConfirm) { this.deleteConfirm = false; clearTimeout(this.deleteTimer); this.invalidate(); return; }
			if (this.mode === "detail") { this.mode = "list"; this.invalidate(); return; }
			if (this.mode === "search-input" || this.mode === "search-results") {
				this.mode = "list"; this.searchQuery = ""; this.filtered = this.memories;
				this.selectedIndex = 0; this.currentPage = 0; this.invalidate(); return;
			}
			this.onClose();
			return;
		}

		if (this.mode === "search-input") {
			if (matchesKey(data, "enter")) {
				await this.runSearch();
				this.mode = "search-results";
				this.selectedIndex = 0; this.currentPage = 0;
				this.invalidate();
			} else if (matchesKey(data, "backspace")) {
				this.searchQuery = this.searchQuery.slice(0, -1); this.invalidate();
			} else if (data.length === 1) {
				this.searchQuery += data; this.invalidate();
			}
			return;
		}

		if (this.mode === "detail") {
			if (matchesKey(data, "d")) {
				this.deleteConfirm = true;
				clearTimeout(this.deleteTimer);
				this.deleteTimer = setTimeout(() => { this.deleteConfirm = false; this.invalidate(); }, 3000);
				this.invalidate();
			} else if (this.deleteConfirm && matchesKey(data, "y")) {
				await this.doDelete(); this.mode = "list"; this.invalidate();
			}
			return;
		}

		// list / search-results navigation
		const list = this.filtered;
		const totalPages = Math.ceil(list.length / this.pageSize);

		if (matchesKey(data, "down") || matchesKey(data, "j")) {
			const pageLen = Math.min(this.pageSize, list.length - this.currentPage * this.pageSize);
			if (this.selectedIndex < pageLen - 1) this.selectedIndex++;
			else if (this.currentPage < totalPages - 1) { this.currentPage++; this.selectedIndex = 0; }
			this.invalidate();
		} else if (matchesKey(data, "up") || matchesKey(data, "k")) {
			if (this.selectedIndex > 0) this.selectedIndex--;
			else if (this.currentPage > 0) { this.currentPage--; this.selectedIndex = this.pageSize - 1; }
			this.invalidate();
		} else if (matchesKey(data, "pagedown") || matchesKey(data, "ctrl+d")) {
			this.currentPage = Math.min(this.currentPage + 1, totalPages - 1); this.selectedIndex = 0; this.invalidate();
		} else if (matchesKey(data, "pageup") || matchesKey(data, "ctrl+u")) {
			this.currentPage = Math.max(this.currentPage - 1, 0); this.selectedIndex = 0; this.invalidate();
		} else if (matchesKey(data, "g")) {
			this.currentPage = 0; this.selectedIndex = 0; this.invalidate();
		} else if (matchesKey(data, "G")) {
			this.currentPage = Math.max(totalPages - 1, 0);
			const lastLen = list.length - this.currentPage * this.pageSize;
			this.selectedIndex = Math.max(Math.min(lastLen, this.pageSize) - 1, 0);
			this.invalidate();
		} else if (matchesKey(data, "/")) {
			this.mode = "search-input"; this.searchQuery = ""; this.invalidate();
		} else if (matchesKey(data, "enter") || matchesKey(data, "v")) {
			if (list.length > 0) { this.mode = "detail"; this.invalidate(); }
		} else if (matchesKey(data, "d")) {
			if (list.length > 0) {
				this.deleteConfirm = true;
				clearTimeout(this.deleteTimer);
				this.deleteTimer = setTimeout(() => { this.deleteConfirm = false; this.invalidate(); }, 3000);
				this.invalidate();
			}
		} else if (this.deleteConfirm && matchesKey(data, "y")) {
			await this.doDelete(); this.invalidate();
		}
	}

	private async runSearch(): Promise<void> {
		if (!this.searchQuery.trim()) { this.filtered = this.memories; return; }
		const result = await this.execVoidm(["search", this.searchQuery, "--min-score", "0", "--json", "--limit", "50"]);
		const arr = parseJson<any[]>(result.stdout);
		this.filtered = (arr ?? []).map(memoryFromJson);
	}

	private async doDelete(): Promise<void> {
		const mem = this.getSelected();
		if (!mem) return;
		await this.execVoidm(["delete", mem.id, "--yes", "--json"]);
		this.memories = this.memories.filter(m => m.id !== mem.id);
		this.filtered = this.filtered.filter(m => m.id !== mem.id);
		this.deleteConfirm = false;
		if (this.selectedIndex >= this.filtered.length && this.selectedIndex > 0) this.selectedIndex--;
	}

	private getSelected(): Memory | undefined {
		return this.filtered[this.currentPage * this.pageSize + this.selectedIndex];
	}

	render(width: number): string[] {
		if (!this.dirty && this.cachedWidth === width) return this.cachedLines!;

		const th = this.theme;
		const lines: string[] = [""];

		if (this.mode === "search-input") {
			lines.push(trunc(th.fg("borderMuted", "───") + th.fg("accent", " Search ") + th.fg("borderMuted", "─".repeat(Math.max(0, width - 11))), width));
			lines.push("");
			lines.push(trunc(`  ${th.fg("muted", "Query: ")}${th.fg("text", this.searchQuery)}${th.fg("dim", "_")}`, width));
			lines.push("");
			lines.push(trunc(th.fg("dim", "  Enter to search · Esc to cancel"), width));

		} else if (this.mode === "detail") {
			const mem = this.getSelected();
			if (!mem) {
				lines.push(trunc(th.fg("error", "  Memory not found"), width));
			} else {
				const typeColor = typeColors[mem.type] ?? "muted";
				lines.push(trunc(th.fg("borderMuted", "───") + th.fg("accent", " Memory ") + th.fg("borderMuted", "─".repeat(Math.max(0, width - 11))), width));
				lines.push("");
				lines.push(trunc(`  ${th.fg(typeColor, mem.type.toUpperCase())}  ${th.fg("dim", `importance: ${mem.importance}/10`)}`, width));
				if (mem.scopes.length) lines.push(trunc(`  ${th.fg("dim", `scopes: ${mem.scopes.join(", ")}`)}`, width));
				if (mem.tags.length) lines.push(trunc(`  ${th.fg("dim", `tags: ${mem.tags.map(t => "#" + t).join(" ")}`)}`, width));
				lines.push("");
				lines.push(trunc(th.fg("borderMuted", "─".repeat(width)), width));
				lines.push("");
				for (const l of wordWrap(mem.content, width - 4)) lines.push(trunc(`  ${l}`, width));
				lines.push("");
				lines.push(trunc(th.fg("borderMuted", "─".repeat(width)), width));
				lines.push("");
				lines.push(trunc(th.fg("dim", `  id: ${mem.id}`), width));
				lines.push(trunc(th.fg("dim", `  created: ${mem.created_at}`), width));
				lines.push("");
				lines.push(trunc(this.deleteConfirm ? th.fg("error", "  Delete? Press y to confirm") : th.fg("dim", "  d: delete · Esc: back"), width));
			}

		} else {
			// list / search-results
			const label = this.mode === "search-results" ? ` Search: "${this.searchQuery}" ` : " Memories ";
			lines.push(trunc(th.fg("borderMuted", "───") + th.fg("accent", label) + th.fg("borderMuted", "─".repeat(Math.max(0, width - label.length - 3))), width));
			lines.push("");

			if (this.filtered.length === 0) {
				lines.push(trunc(`  ${th.fg("dim", "No memories.")}`, width));
			} else {
				const totalPages = Math.ceil(this.filtered.length / this.pageSize);
				const pageMemories = this.filtered.slice(this.currentPage * this.pageSize, (this.currentPage + 1) * this.pageSize);
				const counts = countTypes(this.filtered);
				lines.push(trunc(`  ${th.fg("muted", `${this.filtered.length} total · ${counts}`)}`, width));
				if (totalPages > 1) lines[lines.length - 1] += th.fg("dim", `  p${this.currentPage + 1}/${totalPages}`);
				lines.push("");

				for (let i = 0; i < pageMemories.length; i++) {
					const mem = pageMemories[i];
					const selected = i === this.selectedIndex;
					const typeColor = typeColors[mem.type] ?? "muted";
					const typeLabel = th.fg(typeColor, mem.type.slice(0, 3).toUpperCase());
					const imp = th.fg("dim", `[${mem.importance}]`);
					const scope = mem.scopes[0] ? th.fg("dim", ` (${mem.scopes[0]})`) : "";
					const preview = oneLine(mem.content, width - 22);
					const prefix = selected ? th.fg("accent", "❯ ") : "  ";
					lines.push(trunc(`${prefix}${typeLabel} ${imp}${scope} ${th.fg(selected ? "text" : "muted", preview)}`, width));
				}
			}

			lines.push("");
			lines.push(trunc(
				this.deleteConfirm
					? th.fg("error", "Delete? Press y to confirm")
					: th.fg("dim", "↑↓: nav · /: search · v: view · d: del · g/G: top/bot · Esc: close"),
				width,
			));
		}

		lines.push("");
		this.dirty = false;
		this.cachedWidth = width;
		this.cachedLines = lines;
		return lines;
	}

	invalidate() { this.dirty = true; this.cachedWidth = undefined; }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const typeColors: Record<string, string> = {
	episodic: "muted",
	semantic: "accent",
	procedural: "success",
	conceptual: "warning",
	contextual: "info",
};

function trunc(s: string, w: number) { return truncateToWidth(s, w); }

function oneLine(s: string, max: number): string {
	const flat = s.replace(/\n+/g, " ").replace(/\s+/g, " ").trim();
	return flat.length > max ? flat.slice(0, max - 1) + "…" : flat;
}

function wordWrap(text: string, maxWidth: number): string[] {
	const out: string[] = [];
	for (const para of text.split("\n")) {
		if (para.length <= maxWidth) { out.push(para); continue; }
		let cur = "";
		for (const word of para.split(" ")) {
			if (cur && (cur + " " + word).length > maxWidth) { out.push(cur); cur = word; }
			else cur = cur ? cur + " " + word : word;
		}
		if (cur) out.push(cur);
	}
	return out;
}

function countTypes(ms: Memory[]): string {
	const c: Record<string, number> = {};
	for (const m of ms) c[m.type] = (c[m.type] ?? 0) + 1;
	return Object.entries(c).map(([k, v]) => `${v} ${k}`).join(", ");
}

// ---------------------------------------------------------------------------
// Extension entry point
// ---------------------------------------------------------------------------

export default function (pi: ExtensionAPI) {
	let memoryCache: Memory[] = [];

	const reconstructCache = (ctx: ExtensionContext) => {
		memoryCache = [];
		for (const entry of ctx.sessionManager.getBranch()) {
			if (entry.type !== "message") continue;
			const msg = entry.message;
			if (msg.role !== "toolResult" || msg.toolName !== "memory") continue;
			const d = msg.details as MemoryDetails | undefined;
			if (d?.memories?.length) memoryCache = d.memories;
		}
	};

	pi.on("session_start",  async (_e, ctx) => reconstructCache(ctx));
	pi.on("session_switch", async (_e, ctx) => reconstructCache(ctx));
	pi.on("session_fork",   async (_e, ctx) => reconstructCache(ctx));
	pi.on("session_tree",   async (_e, ctx) => reconstructCache(ctx));

	// -------------------------------------------------------------------------
	// memory tool
	// -------------------------------------------------------------------------
	pi.registerTool({
		name: "memory",
		label: "Memory",
		description: `Manage persistent memories across sessions using voidm.

Actions:
  add       Store a new memory. Required: content, type. Optional: scope, tags, importance (1-10).
            Types: episodic | semantic | procedural | conceptual | contextual
            Response includes suggested_links (≥0.7 similarity) and duplicate_warning (≥0.95).
            After adding: check suggested_links and call action=link for relevant ones.

  search    Hybrid search (vector+BM25+fuzzy). Required: query. Optional: mode, scope, min_score, limit.
            Modes: hybrid (default, filtered at min_score=0.3), semantic, bm25, fuzzy, keyword.
            Use min_score=0 to disable threshold. Empty results include best_score for retry guidance.

  list      List memories newest-first. Optional: scope, type, limit.

  delete    Delete a memory by id. Required: id. Accepts full UUID or short prefix (min 4 chars).

  link      Create a graph edge. Required: from_id, rel, to_id. Use note when rel=RELATES_TO.
            All IDs accept full UUID or short prefix (min 4 chars).
            Rels: SUPPORTS | CONTRADICTS | DERIVED_FROM | PRECEDES | PART_OF | EXEMPLIFIES | INVALIDATES | RELATES_TO

  neighbors Get N-hop graph neighbors of a memory. Required: id (full or short prefix). Optional: depth (default 1).

  pagerank  Rank memories by graph centrality. Optional: limit (default 10).

  cypher    Execute a read-only Cypher query against the memory graph. Required: cypher_query.
            Supported clauses: MATCH, WHERE, RETURN, ORDER BY, LIMIT, WITH.
            Write operations (CREATE, MERGE, SET, DELETE, REMOVE, DROP) are rejected.
            Node properties: memory_id, type, importance, created_at.
            Edge properties: rel_type, note.
            Examples:
              MATCH (a:Memory)-[:SUPPORTS]->(b:Memory) RETURN a.memory_id, b.memory_id LIMIT 10
              MATCH (a)-[:RELATES_TO]-(b) WHERE a.memory_id = '<id>' RETURN b.memory_id
              MATCH (a)-[*1..3]->(b) RETURN a.memory_id, b.memory_id ORDER BY a.memory_id LIMIT 20
              MATCH (a)-[r]->(b) RETURN a.memory_id, r.rel_type, b.memory_id LIMIT 50`,

		parameters: MemoryParams,

		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			try {
				switch (params.action) {

					// ---- add ----
					case "add": {
						if (!params.content) return err("add", "content is required");
						if (!params.type) return err("add", "type is required (episodic|semantic|procedural|conceptual|contextual)");

						const args = [
							"add",
							"--type", params.type,
							"--importance", String(params.importance ?? 5),
							"--json",
						];
						if (params.scope)  args.push("--scope", params.scope);
						if (params.tags)   args.push("--tags", params.tags);
						args.push("--", params.content);

						const { stdout, code } = await execVoidm(args);
						if (code !== 0) {
							const e = parseJson<any>(stdout);
							return err("add", e?.error ?? stdout);
						}
						const resp = parseJson<any>(stdout);
						if (!resp?.id) return err("add", "unexpected response from voidm");

						const mem = memoryFromJson(resp);
						memoryCache = [mem, ...memoryCache.filter(m => m.id !== mem.id)];

						// Build human-readable summary of suggested links
						const links: SuggestedLink[] = resp.suggested_links ?? [];
						const dup = resp.duplicate_warning;

						let msg = `Added memory ${mem.id} (${mem.type})`;
						if (dup) msg += `\n⚠ Duplicate warning (score ${dup.score.toFixed(2)}): "${oneLine(dup.content, 80)}" [${dup.id}]`;
						if (links.length) {
							msg += `\nSuggested links (call action=link to connect):`;
							for (const l of links) {
								msg += `\n  ${l.id} score=${l.score.toFixed(2)} — ${l.hint} — "${oneLine(l.content, 60)}"`;
							}
						}

						return {
							content: [{ type: "text", text: msg }],
							details: { action: "add", memories: [...memoryCache], message: msg } as MemoryDetails,
						};
					}

					// ---- search ----
					case "search": {
						if (!params.query) return err("search", "query is required");

						const args = ["search", "--json"];
						if (params.mode)      args.push("--mode", params.mode);
						if (params.scope)     args.push("--scope", params.scope);
						if (params.limit)     args.push("--limit", String(params.limit));
						if (params.min_score != null) args.push("--min-score", String(params.min_score));
						if (params.include_neighbors) args.push("--include-neighbors");
						if (params.neighbor_depth != null) args.push("--neighbor-depth", String(params.neighbor_depth));
						if (params.neighbor_decay != null) args.push("--neighbor-decay", String(params.neighbor_decay));
						if (params.neighbor_min_score != null) args.push("--neighbor-min-score", String(params.neighbor_min_score));
						if (params.neighbor_limit != null) args.push("--neighbor-limit", String(params.neighbor_limit));
						if (params.edge_types?.length) args.push("--edge-types", params.edge_types.join(","));
						args.push("--", params.query);

						const { stdout } = await execVoidm(args);
						const parsed = parseJson<any>(stdout);

						// Empty with threshold info
						if (parsed && !Array.isArray(parsed) && parsed.results !== undefined) {
							const msg = parsed.hint ?? `No results above threshold ${parsed.threshold}. Best score: ${parsed.best_score}`;
							return {
								content: [{ type: "text", text: msg }],
								details: { action: "search", memories: [], message: msg } as MemoryDetails,
							};
						}

						const results: Memory[] = (Array.isArray(parsed) ? parsed : []).map(memoryFromJson);
						memoryCache = results.length ? results : memoryCache;

						const summary = results.map(m => {
							const base = `[${m.type}] ${m.id.slice(0, 8)} (imp:${m.importance}) ${m.scopes[0] ? `(${m.scopes[0]}) ` : ""}— ${oneLine(m.content, 80)}`;
							const raw = parsed && Array.isArray(parsed) ? parsed.find((r: any) => r.id === m.id) : null;
							if (raw?.source === "graph") {
								return `  ↳ ${base} [${raw.rel_type} depth=${raw.hop_depth}]`;
							}
							return base;
						}).join("\n");

						return {
							content: [{ type: "text", text: results.length ? `${results.length} result(s):\n${summary}` : "No results." }],
							details: { action: "search", memories: results, message: `${results.length} results` } as MemoryDetails,
						};
					}

					// ---- list ----
					case "list": {
						const args = ["list", "--json"];
						if (params.scope) args.push("--scope", params.scope);
						if (params.type)  args.push("--type", params.type);
						if (params.limit) args.push("--limit", String(params.limit));

						const { stdout } = await execVoidm(args);
						const parsed = parseJson<any[]>(stdout) ?? [];
						const results = parsed.map(memoryFromJson);
						memoryCache = results;

						const summary = results.map(m =>
							`[${m.type}] ${m.id.slice(0, 8)} (imp:${m.importance}) — ${oneLine(m.content, 80)}`
						).join("\n");

						return {
							content: [{ type: "text", text: `${results.length} memory(ies):\n${summary}` }],
							details: { action: "list", memories: results, message: `${results.length} memories` } as MemoryDetails,
						};
					}

					// ---- delete ----
					case "delete": {
						if (!params.id) return err("delete", "id is required");

						const { stdout, code } = await execVoidm(["delete", params.id, "--yes", "--json"]);
						if (code !== 0) {
							const e = parseJson<any>(stdout);
							return err("delete", e?.error ?? `Memory ${params.id} not found`);
						}
						memoryCache = memoryCache.filter(m => m.id !== params.id);

						return {
							content: [{ type: "text", text: `Deleted memory ${params.id}` }],
							details: { action: "delete", memories: [...memoryCache], message: "Deleted" } as MemoryDetails,
						};
					}

					// ---- link ----
					case "link": {
						if (!params.from_id) return err("link", "from_id is required");
						if (!params.rel)     return err("link", "rel is required");
						if (!params.to_id)   return err("link", "to_id is required");
						if (params.rel === "RELATES_TO" && !params.note)
							return err("link", "note is required when rel=RELATES_TO");

						const args = ["link", params.from_id, params.rel, params.to_id];
						if (params.note) args.push("--note", params.note);
						args.push("--json");

						const { stdout, code } = await execVoidm(args);
						if (code !== 0) {
							const e = parseJson<any>(stdout);
							return err("link", e?.error ?? stdout);
						}

						return {
							content: [{ type: "text", text: `Linked: ${params.from_id.slice(0,8)} -[${params.rel}]→ ${params.to_id.slice(0,8)}` }],
							details: { action: "link", memories: [...memoryCache], message: "Linked" } as MemoryDetails,
						};
					}

					// ---- neighbors ----
					case "neighbors": {
						if (!params.id) return err("neighbors", "id is required");

						const args = ["graph", "neighbors", params.id, "--json"];
						if (params.depth) args.push("--depth", String(params.depth));

						const { stdout, code } = await execVoidm(args);
						if (code !== 0) {
							const e = parseJson<any>(stdout);
							return err("neighbors", e?.error ?? stdout);
						}

						const neighbors = parseJson<any[]>(stdout) ?? [];
						const summary = neighbors.map(n =>
							`[depth ${n.depth}] ${n.memory_id.slice(0,8)} via ${n.rel_type} (${n.direction})`
						).join("\n");

						return {
							content: [{ type: "text", text: neighbors.length ? `${neighbors.length} neighbor(s):\n${summary}` : "No neighbors." }],
							details: { action: "neighbors", memories: [...memoryCache], message: `${neighbors.length} neighbors` } as MemoryDetails,
						};
					}

					// ---- pagerank ----
					case "pagerank": {
						const args = ["graph", "pagerank", "--json", "--top", String(params.limit ?? 10)];
						const { stdout } = await execVoidm(args);
						const ranked = parseJson<any[]>(stdout) ?? [];
						const summary = ranked.map((r, i) => `#${i+1} [${r.score?.toFixed(4)}] ${r.id}`).join("\n");

						return {
							content: [{ type: "text", text: ranked.length ? `Top ${ranked.length} by PageRank:\n${summary}` : "No graph data yet." }],
							details: { action: "pagerank", memories: [...memoryCache], message: "PageRank computed" } as MemoryDetails,
						};
					}

					// ---- cypher ----
					case "cypher": {
						if (!params.cypher_query) return err("list", "cypher_query is required for cypher action");

						const { stdout, stderr, code } = await execVoidm(["graph", "cypher", "--json", params.cypher_query]);
						if (code !== 0) {
							// voidm exits 2 for write-clause rejection or parse error
							const msg = stderr.trim() || stdout.trim();
							return err("list", msg);
						}

						const rows = parseJson<Record<string, any>[]>(stdout) ?? [];
						const summary = rows.length
							? rows.map(row => Object.entries(row).map(([k, v]) => `${k}: ${v}`).join("  |  ")).join("\n")
							: "No results.";

						return {
							content: [{ type: "text", text: `${rows.length} row(s):\n${summary}` }],
							details: { action: "list", memories: [...memoryCache], message: `${rows.length} rows` } as MemoryDetails,
						};
					}

					default:
						return err("list", `Unknown action: ${(params as any).action}`);
				}
			} catch (e) {
				const msg = e instanceof Error ? e.message : String(e);
				return err(params.action, msg);
			}
		},

		renderCall(args, theme) {
			let text = theme.fg("toolTitle", theme.bold("memory ")) + theme.fg("muted", args.action);
			if (args.content)      text += " " + theme.fg("dim", `"${oneLine(args.content, 40)}"`);
			if (args.query)        text += " " + theme.fg("accent", `"${oneLine(args.query, 30)}"`);
			if (args.cypher_query) text += " " + theme.fg("accent", oneLine(args.cypher_query, 60));
			if (args.id)           text += " " + theme.fg("dim", args.id.slice(0, 8));
			if (args.from_id)      text += " " + theme.fg("dim", `${args.from_id.slice(0,8)} -[${args.rel}]→ ${args.to_id?.slice(0,8)}`);
			if (args.type)         text += " " + theme.fg("dim", `[${args.type}]`);
			if (args.scope)        text += " " + theme.fg("dim", `@${args.scope}`);
			return new Text(text, 0, 0);
		},

		renderResult(result, { expanded }, theme) {
			const d = result.details as MemoryDetails | undefined;
			if (!d) return new Text(result.content[0]?.type === "text" ? (result.content[0] as any).text : "", 0, 0);
			if (d.error) return new Text(theme.fg("error", `✗ ${d.error}`), 0, 0);

			switch (d.action) {
				case "add": {
					const m = d.memories[0];
					if (!m) return new Text(theme.fg("dim", "added"), 0, 0);
					const typeColor = typeColors[m.type] ?? "muted";
					let t = theme.fg("success", "✓ ") + theme.fg(typeColor, m.type) + " " + theme.fg("text", oneLine(m.content, 50));
					if (d.message?.includes("Duplicate")) t += "\n" + theme.fg("warning", "⚠ duplicate warning");
					if (d.message?.includes("Suggested")) t += "\n" + theme.fg("accent", "→ suggested links available");
					return new Text(t, 0, 0);
				}
				case "search":
				case "list": {
					if (!d.memories.length) return new Text(theme.fg("dim", d.message ?? "No results"), 0, 0);
					let t = theme.fg("muted", `${d.memories.length} memory(ies)`);
					const show = expanded ? d.memories : d.memories.slice(0, 5);
					for (const m of show) {
						const c = typeColors[m.type] ?? "muted";
						t += `\n${theme.fg(c, m.type.slice(0,3).toUpperCase())} ${theme.fg("dim", `[${m.importance}]`)} ${theme.fg("text", oneLine(m.content, 60))}`;
					}
					if (!expanded && d.memories.length > 5) t += `\n${theme.fg("dim", `… ${d.memories.length - 5} more`)}`;
					return new Text(t, 0, 0);
				}
				case "delete":   return new Text(theme.fg("success", "✓ deleted"), 0, 0);
				case "link":     return new Text(theme.fg("success", "✓ ") + theme.fg("muted", d.message ?? "linked"), 0, 0);
				case "neighbors":
				case "pagerank": return new Text(theme.fg("muted", d.message ?? "done"), 0, 0);
				default:         return new Text(theme.fg("muted", d.message ?? "done"), 0, 0);
			}
		},
	});

	// -------------------------------------------------------------------------
	// /memories command — TUI browser
	// -------------------------------------------------------------------------
	pi.registerCommand("memories", {
		description: "Browse memories with search and navigation",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("/memories requires interactive mode", "error");
				return;
			}
			ctx.ui.setStatus("voidm", "Loading memories…");
			const { stdout, code } = await execVoidm(["list", "--json", "--limit", "500"]);
			ctx.ui.setStatus("voidm", undefined);
			if (code !== 0) {
				ctx.ui.notify("voidm list failed", "error");
				return;
			}
			const parsed = parseJson<any[]>(stdout) ?? [];
			const memories = parsed.map(memoryFromJson);
			memoryCache = memories;

			await ctx.ui.custom<void>((_tui, theme, _kb, done) => {
				const browser = new MemoryBrowser(memories, theme, () => done(), execVoidm);
				return {
					render: (width: number) => browser.render(width),
					handleInput: (data: string) => browser.handleInput(data),
				};
			});
		},
	});
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function err(action: MemoryDetails["action"], message: string) {
	return {
		content: [{ type: "text" as const, text: `Error: ${message}` }],
		details: { action, memories: [], error: message } as MemoryDetails,
	};
}
