---
name: voidm
description: "Persistent semantic memory for agents (principles, patterns, insights)"
---

# voidm — Agent Memory Tool

## Overview

`voidm` is the agent memory tool. Memories persist across sessions in a local SQLite database with hybrid search (vector + BM25 + fuzzy) and an ontology layer for concepts and relationships.

**Always use the `memory` tool** — it is the preferred interface.

## Memory vs Todos vs Skills

| Aspect | Todos | Memories | Skills |
|--------|-------|----------|--------|
| Scope | Session-only | Persistent | Global |
| Purpose | Current tasks | Principles & insights | How-to guides |
| Lifespan | Ephemeral | Permanent | Permanent |

**Store:** principles, patterns, decisions, constraints, lessons learned, system knowledge.
**Don't store:** task logs, session summaries, duplicates of skills.

## Memory Types

| Type | When to use |
|------|-------------|
| `episodic` | Time-bound events, lessons from specific experiences |
| `semantic` | Timeless facts, rules, best practices |
| `procedural` | Step-by-step workflows, runbooks |
| `conceptual` | Architectural decisions, the *why* behind choices |
| `contextual` | Project/env-specific facts: config, conventions, constraints |

---

## Tool Actions

### `remember` — store a memory
```
action=remember, content="...", type=semantic
action=remember, content="...", type=contextual, scope=project/auth, tags="jwt,oauth", importance=8
```
Response includes suggested links (≥0.7 similarity) and duplicate warnings (≥0.95). Call `relate` for relevant suggested links.

### `recall` — search memories and concepts
```
action=recall, query="rust error handling patterns"
action=recall, query="auth service", scope=project/auth, limit=5
```
Returns full memory content. Also surfaces matching ontology concepts.

### `relate` — link two memories
```
action=relate, from_id="abcd1234", rel=SUPPORTS, to_id="efgh5678"
action=relate, from_id="abcd", rel=RELATES_TO, to_id="efgh", note="both deal with JWT expiry"
```
Rels: `SUPPORTS` | `CONTRADICTS` | `DERIVED_FROM` | `PRECEDES` | `PART_OF` | `EXEMPLIFIES` | `RELATES_TO`

---

## Ontology Actions

### `concept_add` — define a concept class
```
action=concept_add, name="AuthService", description="Handles JWT + OAuth2 flows", scope=project/auth
```

### `concept_get` — inspect a concept
```
action=concept_get, id="abcd1234"
```
Returns: name, description, IS_A parents, subclasses, and linked memory instances.

### `link_to_concept` — attach memory to concept
```
action=link_to_concept, memory_id="abcd1234", id="efgh5678"
```
Makes the memory a concrete INSTANCE_OF the concept class.

---

## Best Practices

1. **Search before storing** — avoid duplicates
2. **Use scope** for project isolation (`project/name`, `work/team`)
3. **Link related memories** — the graph improves recall
4. **Concepts for architecture** — define concepts for key system components, then link memories to them
5. **Importance 7+** for hard-won lessons; 5 for facts; 3 for transient context

## Human TUI

`/memories` — browse, search, and delete memories interactively.
