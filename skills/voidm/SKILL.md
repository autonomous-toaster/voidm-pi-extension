---
name: voidm
description: "Persistent semantic memory for agents (principles, patterns, insights)"
---

# voidm — Agent Memory Tool

Persistent memory across sessions: `memory` tool with hybrid search (vector + BM25 + fuzzy), ontology, quality scoring.

**Always use the `memory` tool** (not CLI commands).

## Quick Start

**Before task:** `action=recall, query="<topic or tech>", scope="project/name"` (search memory)

**After task:** Store non-obvious knowledge only (gotchas, decisions, patterns, lessons).

## Memory Types

- **semantic**: timeless facts, rules, principles
- **procedural**: step-by-step workflows
- **conceptual**: architectural decisions ("why")
- **episodic**: lessons from specific events
- **contextual**: project-specific facts/conventions

## Tool Actions

```
action=remember, content="...", type=semantic, importance=8
action=recall, query="...", scope="project/name", limit=5
action=relate, from_id="abc", rel=SUPPORTS, to_id="def"
action=delete, memory_id="abc"
action=concept_add, name="AuthService", description="...", scope="project/auth"
action=link_to_concept, memory_id="abc", id="def"
```

Relationships: `SUPPORTS` | `CONTRADICTS` | `DERIVED_FROM` | `PRECEDES` | `PART_OF` | `EXEMPLIFIES` | `RELATES_TO`

## Don't Store

- ❌ Task completion: "Fixed bug X", "TODO-abc done"
- ❌ Session summaries: "Today I worked on Y"
- ❌ Obvious facts or skill duplicates
- ❌ Time-anchored context: "yesterday", "this session"

## Quality Guidance

Server computes quality score (0.0-1.0) during insert:

- **< 0.5**: Retry with better content (remove markers, improve genericity)
- **0.5-0.7**: Acceptable, consider refining
- **≥ 0.7**: Good, trust server over client warnings

**Scoring factors**: genericity (no "I"/"my"), abstraction (principle not instance), temporal independence, task independence, substance (50+ words).

Example fix:
- ❌ "Today I fixed auth bug. Task done."
- ✅ "Auth separation: validation independent from storage/expiry for testing and reuse."

## Best Practices

1. Search before storing (avoid duplicates)
2. Respect quality < 0.5 as retry signal
3. Link related memories (improves recall)
4. Use scopes for project isolation
5. Define concepts for architecture

## Human TUI

`/memories` — browse, search, delete.
