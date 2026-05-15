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
	title?: string;
	// Optional metadata fields
	author?: string;
	source_reliability?: string;
	quality_score?: number;
	metadata?: Record<string, any>;
}

interface MemoryDetails {
	action: "remember" | "recall" | "relate" | "delete";
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
		title: raw.title ?? undefined,
		// Extract new metadata fields (if voidm returns them)
		author: raw.author ?? undefined,
		source_reliability: raw.source_reliability ?? undefined,
		quality_score: raw.quality_score ?? undefined,
		metadata: raw.metadata ?? undefined,
	};
}

function err(action: string, msg: string) {
	return {
		content: [{ type: "text" as const, text: `Error [${action}]: ${msg}` }],
		details: { action: action as any, memories: [], error: msg } as MemoryDetails,
	};
}

// Helper: format text on one line
function oneLine(s: string, max: number): string {
	const flat = s.replace(/\n+/g, " ").replace(/\s+/g, " ").trim();
	return flat.length > max ? flat.slice(0, max - 1) + "…" : flat;
}

// Type colors for renderResult
const typeColors: Record<string, ThemeColor> = {
	episodic: "muted", semantic: "accent", procedural: "success",
	conceptual: "warning", contextual: "error",
};

// 4-character type badges for display
function getTypePrefix(type: string): string {
	const prefixes: Record<string, string> = {
		episodic: "EPIS", semantic: "SEMA", procedural: "PROC",
		conceptual: "CONC", contextual: "CONT",
	};
	return prefixes[type] ?? "UNKN";
}

// ---------------------------------------------------------------------------
// Memory quality checking — anti-pattern detection
// ---------------------------------------------------------------------------

function checkMemoryQuality(content: string): { ok: boolean; warnings: string[] } {
	const warnings: string[] = [];

	// Task log patterns - refined to reduce false positives
	if (/TODO-[0-9a-f]{8}/i.test(content)) {
		warnings.push("⚠ Contains TODO identifier — avoid storing task status");
	}
	
	// Task language: only warn if clearly in context of completion (not "completion" noun or "implement" verb)
	// Match "done" / "finished" / "fixed" as standalone words (likely past tense verbs)
	// Exclude "completed/completion" as they're often legitimate nouns
	if (/\b(finished|done|fixed)\b/i.test(content) && 
	    /\b(task|issue|bug|feature|work|milestone)\b/i.test(content)) {
		warnings.push("⚠ Looks like a task log — store the lesson, not the completion");
	}
	
	// Temporal markers - only warn if present (legitimately anchoring to session)
	if (/\b(today|yesterday|this session|this morning)\b/i.test(content) &&
	    !/^(Procedure|Step|Example|Note):/i.test(content)) {
		warnings.push("⚠ Contains time markers — memories should be timeless principles");
	}
	
	// Status prefixes - only at document start AND clearly session-related
	if (/^(date|status|update):\s+(march|april|today|yesterday|2026|pending|complete)/i.test(content)) {
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
		"recall",         // search memories
		"relate",         // link two memories
		"delete",         // delete a memory by ID
	] as const),

	// remember
	content:     Type.Optional(Type.String({ description: "Memory content (required for remember)" })),
	type:        Type.Optional(StringEnum(
		["episodic", "semantic", "procedural", "conceptual", "contextual"] as const,
		{ description: "Memory type (required for remember)" }
	)),
	scope:       Type.Optional(Type.String({ description: "Scope prefix, e.g. project/auth (for remember, recall)" })),
	tags:        Type.Optional(Type.String({ description: "Comma-separated tags (for remember)" })),
	importance:  Type.Optional(Type.Number({ description: "Importance 1-10 (for remember, default 5)" })),
	title:       Type.Optional(Type.String({ description: "Brief title/summary (max 200 characters, optional for remember)" })),
	provenance:  Type.Optional(StringEnum(
		["user", "session", "feedback", "audit", "system"] as const,
		{ description: "Workflow provenance - where memory came from in the task (for remember)" }
	)),
	context:     Type.Optional(StringEnum(
		["gotcha", "decision", "procedure", "reference"] as const,
		{ description: "Context type for creation-time categorization (optional). Scoring boost (+0.15): gotcha→debug/optimize, decision→architecture, procedure→implement, reference→understand." }
	)),
	links:       Type.Optional(Type.Array(
		Type.Object({
			target_id: Type.String({ description: "Target memory ID" }),
			rel: StringEnum([
				"SUPPORTS", "CONTRADICTS", "DERIVED_FROM", "PRECEDES", 
				"PART_OF", "EXEMPLIFIES", "RELATES_TO"
			] as const, { description: "Relationship type" }),
			note: Type.Optional(Type.String({ description: "Optional note (required for RELATES_TO)" }))
		}),
		{ description: "Links to create during remember" }
	)),
	author:      Type.Optional(Type.String({ description: "Author (for remember) - exposed but internal use only" })),

	// recall
	query:       Type.Optional(Type.String({ description: "Search query (required for recall)" })),
	limit:       Type.Optional(Type.Number({ description: "Max results (for recall, default 10)" })),
	intent:      Type.Optional(StringEnum(
		["debug", "optimize", "implement", "understand", "architecture", "troubleshoot"] as const,
		{ description: "Search intent for guided expansion and scoring boost (optional)" }
	)),
	min_quality: Type.Optional(Type.Number({ description: "Min quality score (0.0-1.0) for filtering results", minimum: 0, maximum: 1 })),

	// relate
	from_id:     Type.Optional(Type.String({ description: "Source memory ID or short prefix (for relate)" })),
	rel:         Type.Optional(StringEnum(
		["SUPPORTS", "CONTRADICTS", "DERIVED_FROM", "PRECEDES", "PART_OF", "EXEMPLIFIES", "RELATES_TO"] as const,
		{ description: "Relationship type (for relate)" }
	)),
	to_id:       Type.Optional(Type.String({ description: "Target memory ID or short prefix (for relate)" })),
	note:        Type.Optional(Type.String({ description: "Optional note, required when rel=RELATES_TO" })),

	// delete / recall
	memory_id:   Type.Optional(Type.String({ description: "Memory ID or short prefix (for delete)" })),
	min_score:   Type.Optional(Type.Number({ description: "Min retrieval score (0.0-1.0). Prefer 0.7+ for agent recall.", minimum: 0, maximum: 1 })),
});


// ---------------------------------------------------------------------------
// Extension entry point
// ---------------------------------------------------------------------------

export default function (pi: ExtensionAPI) {
	// ---------------------------------------------------------------------------
	// session_start — silent data-quality repair (fast, no model loading)
	// ---------------------------------------------------------------------------
	pi.on("session_start", async (_e, _ctx) => {
		// Fire-and-forget: remove orphaned chunks, check system health.
		// Does not block startup and never shows output to the agent.
		execVoidm(["repair", "--orphans-only", "--json"]).catch(() => {});
	});

	// ---------------------------------------------------------------------------
	// Helper: Detect task type and suggest relevant user behavior query
	// ---------------------------------------------------------------------------
	function detectBehaviorQuery(promptHint: string): string | null {
		const patterns: Record<string, string> = {
			"design|architecture|schema|system": "user's approach to system design",
			"implement|code|refactor|build": "user technical preferences and standards",
			"test|verify|debug|validation": "user's problem-solving workflow",
			"document|explain|analyze|summarize": "user communication style preferences",
			"review|evaluate|improve|quality": "user code quality standards",
		};

		for (const [regex, query] of Object.entries(patterns)) {
			if (new RegExp(regex, "i").test(promptHint)) {
				return query;
			}
		}
		return null;
	}

	// ---------------------------------------------------------------------------
	// before_agent_start — inject minimal memory workflow nudge
	// ---------------------------------------------------------------------------
	pi.on("before_agent_start", async (e, _ctx) => {
		const promptHint = e.prompt.replace(/\s+/g, " ").trim().slice(0, 120);
		const behaviorSuggestion = detectBehaviorQuery(promptHint);

		const reminder = [
			"",
			"[Memory workflow]",
			"BEFORE starting: recall relevant context — memory action=recall query=\"<topic or tool from the task>\"",
			`Task hint: "${promptHint}"`,
			...(behaviorSuggestion ? [
				"",
				"Also helpful: memory action=recall query=\"${behaviorSuggestion}\"",
			] : []),
			"",
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
		description: `Persistent memory across sessions. Store facts, recall relevant context, and link memories.

Actions:
  remember   Store a new memory.
             Required: content, type.
             Optional: scope, tags, importance, title, provenance, context, links.
             Author is forced to "assistant" via the CLI wrapper.

  recall     Search memories.
             Required: query.
             Optional: scope, limit, intent, min_quality, min_score.
             Prefer min_score >= 0.75 to avoid low-signal context pollution.

  relate     Link two memories with a typed relationship.
             Required: from_id, rel, to_id.
             Optional: note (required when rel=RELATES_TO).
             Short prefixes work, but if ambiguous, use full IDs to avoid bulk operations.

  delete     Delete memory by ID or prefix (min 8 characters for prefix).
             Required: memory_id.
             Behavior:
             - Full ID: deletes that single memory
             - Prefix (8+ chars): deletes all matching memories (with --yes flag)
             Example: memory action=delete memory_id=mem_12345678`,

		parameters: MemoryParams,

		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			// Local cache for this tool invocation (for MemoryDetails)
			let lastMemories: Memory[] = [];

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
						if (params.title) args.push("--title", params.title);
						if (params.context) args.push("--context", params.context);
						if (params.provenance) args.push("--provenance", params.provenance);
						
						// Always force author to "assistant" via CLI
						args.push("--author", "assistant");
						
						// PHASE 2 FIX: Add links support during remember
						if (params.links && params.links.length > 0) {
							for (const link of params.links) {
								const linkStr = link.note 
									? `${link.target_id}:${link.rel}:${link.note}`
									: `${link.target_id}:${link.rel}`;
								args.push("--link", linkStr);
							}
						}
						
						args.push("--", params.content);

						const { stdout, code } = await execVoidm(args);
						if (code !== 0) return err("remember", parseJson<any>(stdout)?.error ?? stdout);
						const rawResp = parseJson<any>(stdout);
						const resp = rawResp.result;
						if (!resp?.id) return err("remember", "unexpected response");

						const mem = memoryFromJson(resp);
						lastMemories = [mem, ...lastMemories.filter(m => m.id !== mem.id)];

						let msg = `Stored [${mem.id.slice(0, 8)}] (${mem.type}${params.scope ? `, ${params.scope}` : ""})`;
						
						// Show author from response
						if (resp.author) msg += `, author: ${resp.author}`;
						
						// Quality score from server
						const serverQuality = resp.quality_score as number | undefined;
						if (serverQuality !== undefined && serverQuality !== null) {
							msg += ` — Quality: ${serverQuality.toFixed(2)}`;
						}
						
						// PHASE 2 FIX: Show link count if created
						if (params.links && params.links.length > 0) {
							msg += `\n  Links: ${params.links.length} created`;
						}
						
						// Quality warnings - only show if server quality is low (< 0.7)
						// If server quality is good, client warnings are likely false positives
						const shouldShowClientWarnings = serverQuality === undefined || serverQuality < 0.7;
						if (!quality.ok && shouldShowClientWarnings) {
							msg += `\n\nQuality warnings:`;
							for (const w of quality.warnings) {
								msg += `\n${w}`;
							}
						}
						
						// If server quality is good but client warned, show reassurance
						if (!quality.ok && !shouldShowClientWarnings) {
							msg += `\n✓ Client regex warned, but server analysis shows this is acceptable (score ${serverQuality?.toFixed(2)})`;
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
							details: { action: "remember", memories: [...lastMemories], message: msg } as MemoryDetails,
						};
					}

					// ── recall ────────────────────────────────────────────────────────────
					case "recall": {
						if (!params.query) return err("recall", "query is required");

						const args = ["search", "--json"];
						if (params.scope) args.push("--scope", params.scope);
						if (params.limit) args.push("--limit", String(params.limit));
						if (params.min_quality !== undefined) args.push("--min-quality", String(params.min_quality));
						if (params.intent) args.push("--intent", params.intent);
						args.push("--min-score", String(params.min_score ?? 0.75));
						args.push("--", params.query);

						const memResult = await execVoidm(args);
						const parsed = parseJson<any>(memResult.stdout);
						if (memResult.code !== 0) return err("recall", parsed?.error ?? memResult.stdout);

						const rawResults = Array.isArray(parsed)
							? parsed
							: Array.isArray(parsed?.results)
								? parsed.results
								: [];
						const memories: Memory[] = rawResults.map(memoryFromJson);
						lastMemories = memories.length ? memories : lastMemories;

						if (!memories.length) {
							const hint = parsed?.best_score !== undefined
								? `No memories found above threshold. Best score: ${parsed.best_score}`
								: `No memories found for "${params.query}".`;
							return {
								content: [{ type: "text", text: hint }],
								details: { action: "recall", memories: [], message: hint } as MemoryDetails,
							};
						}

						let text = `${memories.length} memory result(s):\n\n`;
						text += memories.map(m => {
							const header = `[${m.type}] [${m.id.slice(0, 8)}] imp:${m.importance}${m.scopes[0] ? ` (${m.scopes[0]})` : ""}`;
							return `${header}\n${m.content}`;
						}).join("\n\n");

						return {
							content: [{ type: "text", text }],
							details: { action: "recall", memories, message: `${memories.length} memories` } as MemoryDetails,
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
						if (code !== 0) {
							const error = parseJson<any>(stdout)?.error ?? stdout;
							// Better error message for ambiguous IDs
							if (error.includes("ambiguous")) {
								return err("relate", `${error}\n\nUse more characters or the full memory ID.`);
							}
							return err("relate", error);
						}

						try {
							const parsed = parseJson<any>(stdout);
							if (parsed?.result) {
								const rel_data = parsed.result;
								const msg = `Linked [${rel_data.from_id.slice(0, 8)}] -[${rel_data.rel}]→ [${rel_data.to_id.slice(0, 8)}]`;
								return {
									content: [{ type: "text", text: msg }],
									details: {
										action: "relate",
										memories: lastMemories,
										message: msg
									} as MemoryDetails,
								};
							}
							return err("relate", parsed?.error ?? "Failed to relate memories");
						} catch (e) {
							return err("relate", `Failed to parse response: ${e}`);
						}
					}


					// ── delete ────────────────────────────────────────────────────────────
					case "delete": {
						if (!params.memory_id) return err("delete", "memory_id is required");

						const args = ["delete", params.memory_id, "--yes", "--json"];
						const { stdout, code } = await execVoidm(args);

						if (code !== 0) {
							const error = parseJson<any>(stdout)?.error ?? stdout;
							return err("delete", error);
						}

						try {
							const parsed = parseJson<any>(stdout);
							if (parsed?.result?.deleted) {
								const count = parsed.result.count || 1;
								const ids = parsed.result.ids || [];

								// Remove from cache
								lastMemories = lastMemories.filter(m => !ids.some(id => m.id.startsWith(id)));

								// Format response based on count
								let message = "";
								if (count === 1) {
									message = `Deleted memory [${ids[0].slice(0, 8)}]`;
								} else {
									message = `Deleted ${count} memories:\n${ids.map((id: string) => `  • [${id.slice(0, 8)}]"`).join("\n")}`;
								}

								return {
									content: [{ type: "text", text: message }],
									details: {
										action: "delete",
										memories: lastMemories,
										message
									} as MemoryDetails,
							};
						}
						return err("delete", parsed?.error ?? "Failed to delete memory");
					} catch (e) {
						return err("delete", `Failed to parse response: ${e}`);
					}
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
				remember: "success", recall: "accent", relate: "muted", delete: "error",
			};
			const col = actionColor[args.action] ?? "muted" as ThemeColor;
			let text = theme.fg("toolTitle", "memory ") + theme.fg(col, args.action);
			if (args.query)   text += " " + theme.fg("dim", `"${oneLine(args.query, 40)}"`);
			if (args.content) text += " " + theme.fg("dim", `"${oneLine(args.content, 40)}"`);
			if (args.intent)  text += " " + theme.fg("accent", `intent:"${args.intent}"`);
			if (args.memory_id && args.action === "delete") {
				text += " " + theme.fg("dim", `[${args.memory_id.slice(0, 8)}]`);
			}
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
					let t = theme.fg("success", "✓ ") + theme.fg(col, getTypePrefix(mem.type));
					t += " " + theme.fg("dim", `[${mem.id.slice(0, 8)}]`);
					if (mem.title) t += " " + theme.fg("text", `"${mem.title}"`);
					if (expanded) t += "\n" + theme.fg("muted", oneLine(mem.content, 80));
					return new Text(t, 0, 0);
				}
				case "recall": {
					if (!d.memories.length) return new Text(theme.fg("dim", d.message ?? "no results"), 0, 0);
					let t = theme.fg("muted", `${d.memories.length} result(s)`);
					const show = expanded ? d.memories : d.memories.slice(0, 3);
					for (const m of show) {
						const col = typeColors[m.type] ?? "muted";
						const prefix = theme.fg(col, getTypePrefix(m.type));
						const titlePart = m.title ? ` "${theme.fg("text", m.title)}"` : "";
						t += `\n${prefix} ${theme.fg("dim", `[${m.importance}]`)} ${titlePart}${m.title ? "" : theme.fg("text", oneLine(m.content, 50))}`;
					}
					if (!expanded && d.memories.length > 3) t += `\n${theme.fg("dim", `… ${d.memories.length - 3} more`)}`;
					return new Text(t, 0, 0);
				}
				case "relate":
					return new Text(theme.fg("success", "✓ ") + theme.fg("muted", d.message ?? "linked"), 0, 0);
				case "delete":
					return new Text(theme.fg("error", "✗ ") + theme.fg("muted", d.message ?? "deleted"), 0, 0);
				default:
					return new Text(theme.fg("dim", d.message ?? "done"), 0, 0);
			}
		},
	});
}
