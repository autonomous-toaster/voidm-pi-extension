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
	// Optional metadata fields
	author?: string;
	source_reliability?: string;
	quality_score?: number;
	metadata?: Record<string, any>;
}

interface MemoryDetails {
	action: "remember" | "recall" | "relate" | "concept_add" | "concept_get" | "link_to_concept" | "delete";
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
	conceptual: "warning", contextual: "muted",
};

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
		"recall",         // search memories + concepts
		"relate",         // link two memories
		"concept_add",    // define a concept (ontology class node)
		"concept_get",    // inspect a concept + its linked memories
		"link_to_concept",// attach a memory to a concept
		"delete",         // delete a memory by ID
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

	// concept_add / concept_get / link_to_concept / delete
	id:          Type.Optional(Type.String({ description: "Concept ID or short prefix (for concept_get, link_to_concept)" })),
	name:        Type.Optional(Type.String({ description: "Concept name (for concept_add)" })),
	description: Type.Optional(Type.String({ description: "Concept description (for concept_add)" })),
	memory_id:   Type.Optional(Type.String({ description: "Memory ID or short prefix (for link_to_concept, delete)" })),
});


// ---------------------------------------------------------------------------
// Extension entry point
// ---------------------------------------------------------------------------

export default function (pi: ExtensionAPI) {
	// ---------------------------------------------------------------------------
	// Auto-improve database on session start — enrich memories + deduplicate
	// ---------------------------------------------------------------------------
	pi.on("session_start", async (_e, _ctx) => {
		// Fire-and-forget — don't block session startup, don't show output to agent
		execVoidm(["ontology", "auto-improve", "--merge-only", "--force", "--json"]).catch(() => {});
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
		description: `Persistent memory across sessions. Store facts, recall context, define concepts.

Actions:
  remember   Store a new memory.
             Required: content, type.
             Optional: scope (e.g. "project/auth"), tags (comma-separated), importance (1-10, default 5).
             Optional: provenance (workflow source) - values: user, session, feedback, audit, system.
             Optional: context (creation categorization) - values: gotcha, decision, procedure, reference.
             Optional: links (array of {target_id, rel, note} to create relationships during remember).
             
             Note: author is always forced to "assistant" via voidm CLI.
             
             Types: episodic | semantic | procedural | conceptual | contextual
             Returns: memory id, quality_score, suggested related memories.

  recall     Search memories and concepts.
             Required: query.
             Optional: scope (filter by scope prefix), limit (default 10), intent (for guided expansion).
             Optional: min_quality (0.0-1.0 threshold for filtering).
             
             Supported intents: debug, optimize, implement, understand, architecture, troubleshoot
             Intent matching: Uses context parameter for scoring boost. Aligned memories score +0.15 higher.
             
             Returns: full content of matching memories + any matching ontology concepts.
             If no results, suggests a lower threshold automatically.

  relate     Link two memories with a typed relationship.
             Required: from_id, rel, to_id. All IDs accept short prefix (min 4 chars).
             Optional: note (required when rel=RELATES_TO).
             Rels: SUPPORTS | CONTRADICTS | DERIVED_FROM | PRECEDES | PART_OF | EXEMPLIFIES | RELATES_TO

  delete     Delete a memory by ID.
             Required: memory_id (ID or short prefix).
             Use with caution - only delete duplicates or low-quality memories flagged by warnings.

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
						const resp = parseJson<any>(stdout);
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
						if (params.intent) args.push("--intent", params.intent);
						if (params.min_quality !== undefined) args.push("--min-quality", String(params.min_quality));
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
						lastMemories = memories.length ? memories : lastMemories;

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
							details: { action: "relate", memories: lastMemories, message: msg } as MemoryDetails,
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
							details: { action: "concept_add", memories: lastMemories, message: msg } as MemoryDetails,
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
							details: { action: "concept_get", memories: lastMemories, message: text } as MemoryDetails,
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
							details: { action: "link_to_concept", memories: lastMemories, message: msg } as MemoryDetails,
						};
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

						// Remove from cache
						lastMemories = lastMemories.filter(m => !m.id.startsWith(params.memory_id));

						const msg = `Deleted memory [${params.memory_id}]`;
						return {
							content: [{ type: "text", text: msg }],
							details: { action: "delete", memories: [...lastMemories], message: msg } as MemoryDetails,
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
				delete: "error",
			};
			const col = actionColor[args.action] ?? "muted" as ThemeColor;
			let text = theme.fg("toolTitle", "memory ") + theme.fg(col, args.action);
			if (args.query)   text += " " + theme.fg("dim", `"${oneLine(args.query, 40)}"`);
			if (args.content) text += " " + theme.fg("dim", `"${oneLine(args.content, 40)}"`);
			if (args.name)    text += " " + theme.fg("dim", args.name);
			if (args.id)      text += " " + theme.fg("dim", args.id);
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
				case "delete":
					return new Text(theme.fg("error", "✗ ") + theme.fg("muted", d.message ?? "deleted"), 0, 0);
				default:
					return new Text(theme.fg("dim", d.message ?? "done"), 0, 0);
			}
		},
	});
}
