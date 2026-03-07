---
name: voidm
description: "Persistent semantic memory for agents (principles, patterns, insights)"
---

# voidm — Agent Memory Tool

## Overview

`voidm` is the agent memory tool. Memories persist across sessions in a local SQLite database with hybrid search (vector + BM25 + fuzzy) and an ontology layer for concepts and relationships.

**Always use the `memory` tool** — it is the preferred interface.

---

## Workflow — Do This Every Session

### Before starting any task
**Search memory first.** The user may have worked on this before. You may have stored relevant patterns, constraints, architecture decisions, or tool-specific knowledge.

```
action=recall, query="<topic or technology from the task>"
action=recall, query="<framework or tool name>"
action=recall, query="<project name>", scope="project/name"
```

Examples:
- About to write a FastAPI route → `recall query="fastapi dependency injection"`
- About to touch auth code → `recall query="auth service JWT"`, `recall query="oauth patterns"`
- Debugging a Rust compile error → `recall query="rust borrow checker patterns"`
- Starting a new feature → `recall query="<project name> architecture"`

If you find relevant memories: apply that knowledge. If something has changed, update the memory.

### After completing a task
**Store what you learned** — but only if it's non-obvious knowledge worth remembering.

Ask yourself:
- Did I discover a **non-obvious constraint or gotcha**? → `remember` it (semantic, importance 7+)
- Did I make an **architectural or design decision**? → `remember` it (conceptual, importance 8+)
- Did I work out a **step-by-step process**? → `remember` it (procedural, importance 7+)
- Did I find a **project-specific convention**? → `remember` it (contextual, importance 6+)

**Don't store:**
- Task completion: "Fixed bug X", "TODO-abc done"
- Session summaries: "Today I worked on Y"
- Obvious facts already in skills

Before storing, search to avoid duplicates. If a similar memory exists, update it instead (delete + re-add with improved content).

---

## Memory vs Todos vs Skills

| Aspect | Todos | Memories | Skills |
|--------|-------|----------|--------|
| Scope | Session-only | Persistent | Global |
| Purpose | Current tasks | Principles & insights | How-to guides |
| Lifespan | Ephemeral | Permanent | Permanent |

**Store:** principles, patterns, decisions, constraints, lessons learned, system knowledge.

**Don't store:**
- ❌ Session summaries: "Today I worked on X"
- ❌ Task completion logs: "Fixed bug in file.py", "TODO-abc completed"
- ❌ TODO status updates: "Milestone reached", "Task refined"
- ❌ Temporary context: "User is working on project X"
- ❌ Duplicate skills: Don't copy skill content into memory
- ❌ Obvious facts: "Python uses indentation" (already in skills)

---

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

1. **Recall before acting** — always search before starting a task
2. **Search before storing** — avoid duplicates; update existing memories instead
3. **Use scope** for project isolation (`project/name`, `work/team`)
4. **Link related memories** — the graph improves future recall
5. **Concepts for architecture** — define concepts for key components, link memories to them
6. **Importance 8+** for hard-won lessons; 5 for general facts; 3 for transient context

## Human TUI

`/memories` — browse, search, and delete memories interactively.
