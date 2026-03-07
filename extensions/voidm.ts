/**
 * voidm Extension — Persistent memory for AI agents
 * Backed by voidm (local-first, hybrid search, graph + ontology layer).
 */

import { StringEnum } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionContext, Theme, ThemeColor } from "@mariozechner/pi-coding-agent";
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

interface MemoryDetails {
	action: "remember" | "recall" | "relate" | "concept_add" | "concept_get" | "link_to_concept";
	memories: Memory[];
	error?: string;
	message?: string;
}

// ---------------------------------------------------------------------------
// voidm CLI wrapper
// ---------------------------------------------------------------------------

const VOIDM = (() => {
	if (process.env.VOIDM_BIN) return process.env.VOIDM_BIN;
	const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
	const local = `${home}/.local/bin/voidm`;
	try { require("node:fs").accessSync(local, require("node:fs").constants.X_OK); return local; } catch {}
	return "voidm";
})();

async function execVoidm(args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
	try {
		const { stdout, stderr } = await execFileAsync(VOIDM, args, { maxBuffer: 10 * 1024 * 1024 });
		return { stdout, stderr, code: 0 };
	} catch (error: any) {
		return { stdout: error.stdout ?? "", stderr: error.stderr ?? "", code: error.code ?? 1 };
	}
}

function parseJson<T>(raw: string): T | null {
	try { return JSON.parse(raw) as T; } catch { return null; }
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

function err(action: string, msg: string) {
	return {
		content: [{ type: "text" as const, text: `Error [${action}]: ${msg}` }],
		details: { action: action as any, memories: [], error: msg } as MemoryDetails,
	};
}

function oneLine(s: string, max: number): string {
	const flat = s.replace(/\n+/g, " ").replace(/\s+/g, " ").trim();
	return flat.length > max ? flat.slice(0, max - 1) + "…" : flat;
}

// ---------------------------------------------------------------------------
// Memory quality checking — anti-pattern detection
// ---------------------------------------------------------------------------

function checkMemoryQuality(content: string): { ok: boolean; warnings: string[] } {
	const warnings: string[] = [];

	// Task log patterns
	if (/TODO-[0-9a-f]{8}/i.test(content)) {
		warnings.push("⚠ Contains TODO identifier — avoid storing task status");
	}
	if (/\b(milestone|completed?|finished|done|fixed)\b/i.test(content)) {
		warnings.push("⚠ Looks like a task log — store the lesson, not the completion");
	}
	if (/\b(today|yesterday|this session|this morning)\b/i.test(content)) {
		warnings.push("⚠ Contains time markers — memories should be timeless principles");
	}
	if (/^(date|status|update):/i.test(content)) {
		warnings.push("⚠ Starts with status marker — avoid session summaries");
	}

	// Length checks
	if (content.length < 30) {
		warnings.push("⚠ Very short (<30 chars) — add more context for future recall");
	}
	if (content.split(/\s+/).length > 300) {
		warnings.push("⚠ Very long (>300 words) — consider splitting into focused memories");
	}

	return { ok: warnings.length === 0, warnings };
}

// ---------------------------------------------------------------------------
// Tool parameter schema — intentionally minimal
// ---------------------------------------------------------------------------

const MemoryParams = Type.Object({
	action: StringEnum([
		"remember",       // store a memory
		"recall",         // search memories + concepts
		"relate",         // link two memories
		"concept_add",    // define a concept (ontology class node)
		"concept_get",    // inspect a concept + its linked memories
		"link_to_concept",// attach a memory to a concept
	] as const),

	// remember
	content:     Type.Optional(Type.String({ description: "Memory content (required for remember)" })),
	type:        Type.Optional(StringEnum(
		["episodic", "semantic", "procedural", "conceptual", "contextual"] as const,
		{ description: "Memory type (required for remember)" }
	)),
	scope:       Type.Optional(Type.String({ description: "Scope prefix, e.g. project/auth (for remember, recall, concept_add)" })),
	tags:        Type.Optional(Type.String({ description: "Comma-separated tags (for remember)" })),
	importance:  Type.Optional(Type.Number({ description: "Importance 1-10 (for remember, default 5)" })),

	// recall
	query:       Type.Optional(Type.String({ description: "Search query (required for recall)" })),
	limit:       Type.Optional(Type.Number({ description: "Max results (for recall, default 10)" })),

	// relate
	from_id:     Type.Optional(Type.String({ description: "Source memory ID or short prefix (for relate)" })),
	rel:         Type.Optional(StringEnum(
		["SUPPORTS", "CONTRADICTS", "DERIVED_FROM", "PRECEDES", "PART_OF", "EXEMPLIFIES", "RELATES_TO"] as const,
		{ description: "Relationship type (for relate)" }
	)),
	to_id:       Type.Optional(Type.String({ description: "Target memory ID or short prefix (for relate)" })),
	note:        Type.Optional(Type.String({ description: "Optional note, required when rel=RELATES_TO" })),

	// concept_add / concept_get / link_to_concept
	id:          Type.Optional(Type.String({ description: "Concept ID or short prefix (for concept_get, link_to_concept)" })),
	name:        Type.Optional(Type.String({ description: "Concept name (for concept_add)" })),
	description: Type.Optional(Type.String({ description: "Concept description (for concept_add)" })),
	memory_id:   Type.Optional(Type.String({ description: "Memory ID or short prefix to link (for link_to_concept)" })),
});

// ---------------------------------------------------------------------------
// MemoryBrowser TUI
// ---------------------------------------------------------------------------

const typeColors: Record<string, ThemeColor> = {
	episodic: "muted", semantic: "accent", procedural: "success",
	conceptual: "warning", contextual: "muted",
};

function trunc(s: string, w: number) { return truncateToWidth(s, w); }

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
		if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) {
			if (this.deleteConfirm) { this.deleteConfirm = false; clearTimeout(this.deleteTimer); this.invalidate(); return; }
			if (this.mode === "detail") { this.mode = "list"; this.invalidate(); return; }
			if (this.mode === "search-input" || this.mode === "search-results") {
				this.mode = "list"; this.searchQuery = ""; this.filtered = this.memories;
				this.selectedIndex = 0; this.currentPage = 0; this.invalidate(); return;
			}
			this.onClose(); return;
		}
		if (this.mode === "search-input") {
			if (matchesKey(data, "enter")) {
				await this.runSearch(); this.mode = "search-results";
				this.selectedIndex = 0; this.currentPage = 0; this.invalidate();
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
		} else if (matchesKey(data, "pageDown") || matchesKey(data, "ctrl+d")) {
			this.currentPage = Math.min(this.currentPage + 1, totalPages - 1); this.selectedIndex = 0; this.invalidate();
		} else if (matchesKey(data, "pageUp") || matchesKey(data, "ctrl+u")) {
			this.currentPage = Math.max(this.currentPage - 1, 0); this.selectedIndex = 0; this.invalidate();
		} else if (matchesKey(data, "g")) {
			this.currentPage = 0; this.selectedIndex = 0; this.invalidate();
		} else if (data === "G") {
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

	// ---------------------------------------------------------------------------
	// Auto enrich-memories on session start — silently links memories to concepts
	// ---------------------------------------------------------------------------
	pi.on("session_start", async (_e, _ctx) => {
		// Fire-and-forget — don't block session startup, don't show output to agent
		execVoidm(["ontology", "enrich-memories", "--add", "--json"]).catch(() => {});
	});

	// ---------------------------------------------------------------------------
	// before_agent_start — inject memory workflow reminder into system prompt
	// ---------------------------------------------------------------------------
	pi.on("before_agent_start", async (e, _ctx) => {
		const promptHint = e.prompt.replace(/\s+/g, " ").trim().slice(0, 120);
		const reminder = [
			"",
			"[Memory workflow]",
			"BEFORE starting: recall relevant context — memory action=recall query=\"<topic or tool from the task>\"",
			`Task hint: "${promptHint}"`,
			"AFTER completing: IF you discovered non-obvious knowledge (gotcha, decision, constraint), store it.",
			"DON'T store: task logs, TODO status, session summaries, obvious facts.",
		].join("\n");
		return { systemPrompt: e.systemPrompt + "\n\n---" + reminder + "\n---" };
	});

	// ---------------------------------------------------------------------------
	// memory tool
	// ---------------------------------------------------------------------------
	pi.registerTool({
		name: "memory",
		label: "Memory",
		description: `Persistent memory across sessions. Store facts, recall context, define concepts.

Actions:
  remember   Store a new memory.
             Required: content, type.
             Optional: scope (e.g. "project/auth"), tags (comma-separated), importance (1-10, default 5).
             Types: episodic | semantic | procedural | conceptual | contextual
             Returns: memory id + any suggested links to existing related memories.

  recall     Search memories and concepts.
             Required: query.
             Optional: scope (filter by scope prefix), limit (default 10).
             Returns: full content of matching memories + any matching ontology concepts.
             If no results, suggests a lower threshold automatically.

  relate     Link two memories with a typed relationship.
             Required: from_id, rel, to_id. All IDs accept short prefix (min 4 chars).
             Optional: note (required when rel=RELATES_TO).
             Rels: SUPPORTS | CONTRADICTS | DERIVED_FROM | PRECEDES | PART_OF | EXEMPLIFIES | RELATES_TO

── Ontology ────────────────────────────────────────────────────────────────────

  concept_add      Define a concept (class/category node).
                   Required: name. Optional: description, scope.
                   Example: name="AuthService", description="Handles JWT + OAuth2"

  concept_get      Get a concept by ID or short prefix.
                   Required: id.
                   Returns: name, description, IS_A parents, subclasses, and linked memory instances.

  link_to_concept  Attach a memory to a concept via INSTANCE_OF.
                   Required: memory_id, id (concept id or short prefix).
                   Makes the memory a concrete instance of that concept class.`,

		parameters: MemoryParams,

		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			try {
				switch (params.action) {

					// ── remember ──────────────────────────────────────────────────────────
					case "remember": {
						if (!params.content) return err("remember", "content is required");
						if (!params.type)    return err("remember", "type is required");

						// Quality check — warn but don't block
						const quality = checkMemoryQuality(params.content);

						const args = ["add", "--type", params.type, "--importance", String(params.importance ?? 5), "--json"];
						if (params.scope) args.push("--scope", params.scope);
						if (params.tags)  args.push("--tags", params.tags);
						args.push("--", params.content);

						const { stdout, code } = await execVoidm(args);
						if (code !== 0) return err("remember", parseJson<any>(stdout)?.error ?? stdout);
						const resp = parseJson<any>(stdout);
						if (!resp?.id) return err("remember", "unexpected response");

						const mem = memoryFromJson(resp);
						memoryCache = [mem, ...memoryCache.filter(m => m.id !== mem.id)];

						let msg = `Stored [${mem.id.slice(0, 8)}] (${mem.type}${params.scope ? `, ${params.scope}` : ""})`;
						
						// Quality warnings
						if (!quality.ok) {
							msg += `\n\nQuality warnings:`;
							for (const w of quality.warnings) {
								msg += `\n${w}`;
							}
						}
						
						const dup = resp.duplicate_warning;
						if (dup) msg += `\n⚠ Similar memory exists [${dup.id.slice(0, 8)}] (score ${dup.score.toFixed(2)}): ${oneLine(dup.content, 80)}`;
						const links: any[] = resp.suggested_links ?? [];
						if (links.length) {
							msg += `\nRelated memories (use relate to connect):`;
							for (const l of links.slice(0, 3)) {
								msg += `\n  [${l.id.slice(0, 8)}] ${l.hint} — ${oneLine(l.content, 70)}`;
							}
						}

						return {
							content: [{ type: "text", text: msg }],
							details: { action: "remember", memories: [...memoryCache], message: msg } as MemoryDetails,
						};
					}

					// ── recall ────────────────────────────────────────────────────────────
					case "recall": {
						if (!params.query) return err("recall", "query is required");

						const args = ["search", "--json"];
						if (params.scope) args.push("--scope", params.scope);
						if (params.limit) args.push("--limit", String(params.limit));
						args.push("--", params.query);

						const conceptArgs = ["ontology", "concept", "list", "--json"];
						if (params.scope) conceptArgs.push("--scope", params.scope);

						const [memResult, conceptResult] = await Promise.all([
							execVoidm(args),
							execVoidm(conceptArgs),
						]);

						const parsed = parseJson<any>(memResult.stdout);

						// Empty result with threshold info
						if (parsed && !Array.isArray(parsed) && "results" in parsed) {
							const hint = parsed.hint ?? `No results above threshold. Best score: ${parsed.best_score}`;
							return {
								content: [{ type: "text", text: hint }],
								details: { action: "recall", memories: [], message: hint } as MemoryDetails,
							};
						}

						const memories: Memory[] = (Array.isArray(parsed) ? parsed : []).map(memoryFromJson);
						memoryCache = memories.length ? memories : memoryCache;

						// Concept match — simple substring
						const allConcepts: any[] = parseJson<any[]>(conceptResult.stdout) ?? [];
						const q = params.query.toLowerCase();
						const matchedConcepts = allConcepts.filter(c =>
							c.name?.toLowerCase().includes(q) || c.description?.toLowerCase().includes(q)
						);

						let text = "";
						if (memories.length) {
							text += `${memories.length} memory result(s):\n\n`;
							text += memories.map(m => {
								const header = `[${m.type}] [${m.id.slice(0, 8)}] imp:${m.importance}${m.scopes[0] ? ` (${m.scopes[0]})` : ""}`;
								return `${header}\n${m.content}`;
							}).join("\n\n");
						}
						if (matchedConcepts.length) {
							if (text) text += "\n\n";
							text += `${matchedConcepts.length} concept(s) matching "${params.query}":\n`;
							text += matchedConcepts.map(c => {
								let s = `[concept] [${c.id.slice(0, 8)}] ${c.name}`;
								if (c.description) s += ` — ${c.description}`;
								if (c.scope) s += ` (${c.scope})`;
								return s;
							}).join("\n");
						}
						if (!text) text = `No memories or concepts found for "${params.query}".`;

						return {
							content: [{ type: "text", text }],
							details: { action: "recall", memories, message: `${memories.length} memories, ${matchedConcepts.length} concepts` } as MemoryDetails,
						};
					}

					// ── relate ────────────────────────────────────────────────────────────
					case "relate": {
						if (!params.from_id) return err("relate", "from_id is required");
						if (!params.rel)     return err("relate", "rel is required");
						if (!params.to_id)   return err("relate", "to_id is required");
						if (params.rel === "RELATES_TO" && !params.note) return err("relate", "note is required when rel=RELATES_TO");

						const args = ["link", params.from_id, params.rel, params.to_id, "--json"];
						if (params.note) args.push("--note", params.note);

						const { stdout, code } = await execVoidm(args);
						if (code !== 0) return err("relate", parseJson<any>(stdout)?.error ?? stdout);
						const msg = `Linked [${params.from_id.slice(0, 8)}] -[${params.rel}]→ [${params.to_id.slice(0, 8)}]`;
						return {
							content: [{ type: "text", text: msg }],
							details: { action: "relate", memories: memoryCache, message: msg } as MemoryDetails,
						};
					}

					// ── concept_add ───────────────────────────────────────────────────────
					case "concept_add": {
						if (!params.name) return err("concept_add", "name is required");
						const args = ["ontology", "concept", "add", params.name, "--json"];
						if (params.description) args.push("--description", params.description);
						if (params.scope)       args.push("--scope", params.scope);

						const { stdout, code } = await execVoidm(args);
						if (code !== 0) return err("concept_add", parseJson<any>(stdout)?.error ?? stdout);
						const concept = parseJson<any>(stdout);
						if (!concept?.id) return err("concept_add", "unexpected response");

						const msg = `Concept created: ${concept.name} [${concept.id.slice(0, 8)}]${concept.description ? ` — ${concept.description}` : ""}`;
						return {
							content: [{ type: "text", text: msg }],
							details: { action: "concept_add", memories: memoryCache, message: msg } as MemoryDetails,
						};
					}

					// ── concept_get ───────────────────────────────────────────────────────
					case "concept_get": {
						if (!params.id) return err("concept_get", "id is required");
						const { stdout, code } = await execVoidm(["ontology", "concept", "get", params.id, "--json"]);
						if (code !== 0) return err("concept_get", parseJson<any>(stdout)?.error ?? stdout);
						const c = parseJson<any>(stdout);
						if (!c?.id) return err("concept_get", "not found");

						let text = `[${c.id.slice(0, 8)}] ${c.name}`;
						if (c.description) text += `\n  ${c.description}`;
						if (c.scope)       text += `\n  scope: ${c.scope}`;
						if (c.superclasses?.length) text += `\n  IS_A: ${c.superclasses.map((x: any) => x.name).join(", ")}`;
						if (c.subclasses?.length)   text += `\n  Subclasses: ${c.subclasses.map((x: any) => x.name).join(", ")}`;
						if (c.instances?.length) {
							text += `\n  Instances (${c.instances.length}):`;
							for (const inst of c.instances.slice(0, 5)) {
								text += `\n    [${inst.memory_id.slice(0, 8)}] ${inst.preview}`;
							}
							if (c.instances.length > 5) text += `\n    … ${c.instances.length - 5} more`;
						} else {
							text += `\n  Instances: none`;
						}

						return {
							content: [{ type: "text", text }],
							details: { action: "concept_get", memories: memoryCache, message: text } as MemoryDetails,
						};
					}

					// ── link_to_concept ───────────────────────────────────────────────────
					case "link_to_concept": {
						if (!params.memory_id) return err("link_to_concept", "memory_id is required");
						if (!params.id)        return err("link_to_concept", "id (concept) is required");

						const args = ["ontology", "link", params.memory_id, "--from-kind", "memory",
							"INSTANCE_OF", params.id, "--to-kind", "concept", "--json"];
						const { stdout, code } = await execVoidm(args);
						if (code !== 0) return err("link_to_concept", parseJson<any>(stdout)?.error ?? stdout);

						const msg = `Memory [${params.memory_id.slice(0, 8)}] is now an instance of concept [${params.id.slice(0, 8)}]`;
						return {
							content: [{ type: "text", text: msg }],
							details: { action: "link_to_concept", memories: memoryCache, message: msg } as MemoryDetails,
						};
					}

					default:
						return err("memory", `Unknown action: ${(params as any).action}`);
				}
			} catch (e) {
				return err(params.action, e instanceof Error ? e.message : String(e));
			}
		},

		renderCall(args, theme) {
			const actionColor: Record<string, ThemeColor> = {
				remember: "success", recall: "accent", relate: "muted",
				concept_add: "warning", concept_get: "warning", link_to_concept: "warning",
			};
			const col = actionColor[args.action] ?? "muted" as ThemeColor;
			let text = theme.fg("toolTitle", "memory ") + theme.fg(col, args.action);
			if (args.query)   text += " " + theme.fg("dim", `"${oneLine(args.query, 40)}"`);
			if (args.content) text += " " + theme.fg("dim", `"${oneLine(args.content, 40)}"`);
			if (args.name)    text += " " + theme.fg("dim", args.name);
			if (args.id)      text += " " + theme.fg("dim", args.id);
			return new Text(text, 0, 0);
		},

		renderResult(result, { expanded }, theme) {
			const d = result.details as MemoryDetails | undefined;
			if (!d) return new Text(theme.fg("dim", (result.content?.[0] as any)?.text ?? "done"), 0, 0);
			if (d.error) return new Text(theme.fg("error", `✗ ${d.error}`), 0, 0);

			switch (d.action) {
				case "remember": {
					const mem = d.memories?.[0];
					if (!mem) return new Text(theme.fg("muted", d.message ?? "stored"), 0, 0);
					const col = typeColors[mem.type] ?? "muted";
					let t = theme.fg("success", "✓ ") + theme.fg(col, mem.type.slice(0, 3).toUpperCase());
					t += " " + theme.fg("dim", `[${mem.id.slice(0, 8)}]`);
					if (expanded) t += "\n" + theme.fg("muted", oneLine(mem.content, 80));
					return new Text(t, 0, 0);
				}
				case "recall": {
					if (!d.memories.length) return new Text(theme.fg("dim", d.message ?? "no results"), 0, 0);
					let t = theme.fg("muted", `${d.memories.length} result(s)`);
					const show = expanded ? d.memories : d.memories.slice(0, 3);
					for (const m of show) {
						const col = typeColors[m.type] ?? "muted";
						t += `\n${theme.fg(col, m.type.slice(0, 3).toUpperCase())} ${theme.fg("dim", `[${m.importance}]`)} ${theme.fg("text", oneLine(m.content, 60))}`;
					}
					if (!expanded && d.memories.length > 3) t += `\n${theme.fg("dim", `… ${d.memories.length - 3} more`)}`;
					return new Text(t, 0, 0);
				}
				case "relate":
					return new Text(theme.fg("success", "✓ ") + theme.fg("muted", d.message ?? "linked"), 0, 0);
				case "concept_add":
					return new Text(theme.fg("success", "✓ ") + theme.fg("warning", d.message ?? "concept created"), 0, 0);
				case "concept_get":
					return new Text(theme.fg("warning", "◆ ") + theme.fg("muted", d.message?.split("\n")[0] ?? "concept"), 0, 0);
				case "link_to_concept":
					return new Text(theme.fg("success", "✓ ") + theme.fg("muted", d.message ?? "linked"), 0, 0);
				default:
					return new Text(theme.fg("dim", d.message ?? "done"), 0, 0);
			}
		},
	});

	// ---------------------------------------------------------------------------
	// /memories command — human TUI browser
	// ---------------------------------------------------------------------------
	pi.registerCommand("memories", {
		description: "Browse memories with search and navigation",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("/memories requires interactive mode", "error");
				return;
			}
			ctx.ui.setStatus("voidm", "Loading memories…");
			const result = await execVoidm(["list", "--json", "--limit", "200"]);
			ctx.ui.setStatus("voidm", undefined);
			const parsed = parseJson<any[]>(result.stdout) ?? [];
			const memories = parsed.map(memoryFromJson);

			await ctx.ui.custom<void>((tui, theme, _kb, done) => {
				const browser = new MemoryBrowser(memories, theme, done, execVoidm);
				return {
					render(width: number) { return browser.render(width); },
					invalidate() { browser.invalidate(); },
					handleInput(data: string) {
						browser.handleInput(data).then(() => tui.requestRender());
					},
				};
			});
		},
	});
}
