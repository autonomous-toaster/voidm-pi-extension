---
name: voidm
description: "Persistent semantic memory for agents (principles, patterns, insights)"
---

# voidm — Agent Memory Tool

## Overview

`voidm` is the agent memory tool. Memories persist across sessions in a local SQLite database with hybrid search (vector + BM25 + fuzzy) and a graph layer for linking related memories.

**Always use the `memory` tool** — it is the preferred interface. The `voidm` CLI exists for humans and debugging. Do not call the CLI directly unless the `memory` tool is unavailable.

## Memory vs Todos vs Skills

| Aspect | Todos | Memories | Skills |
|--------|-------|----------|--------|
| Scope | Session-only | Persistent | Global |
| Purpose | Current tasks | Principles & insights | How-to guides |
| Lifespan | Ephemeral | Permanent | Permanent |

**What to store:** principles, patterns, decisions, constraints, lessons learned, system knowledge.
**What NOT to store:** task logs ("fixed X"), session summaries, duplicates of what's in skills.

## Memory Types

| Type | When to use |
|------|-------------|
| `episodic` | Time-bound events, lessons from specific experiences |
| `semantic` | Timeless facts, rules, best practices |
| `procedural` | Step-by-step workflows, runbooks |
| `conceptual` | Architectural decisions, the *why* behind choices |
| `contextual` | Project/env-specific facts: config, conventions, constraints |

**Decision flowchart:**
- Step-by-step process? → `procedural`
- Why a decision was made? → `conceptual`
- Timeless fact? → `semantic`
- Project/env-specific? → `contextual`
- Something that happened? → `episodic`

---

## Using the `memory` Tool

This is the **primary interface**. All actions go through a single `memory` tool call.

### Add

```
action=add, content="...", type=semantic, scope=work/acme, tags="rust,perf", importance=8
```

Response includes:
- `suggested_links` (similarity ≥ 0.7) — check these and call `action=link` for relevant ones
- `duplicate_warning` (similarity ≥ 0.95) — near-identical content exists, consider skipping

### Search

```
action=search, query="deployment checklist", scope=work/acme
action=search, query="database", mode=semantic, min_score=0
```

Modes: `hybrid` (default), `semantic`, `bm25`, `fuzzy`, `keyword`.
Empty hybrid results include `best_score` — use it to decide whether to retry with lower `min_score`.

### List

```
action=list, scope=work/acme, limit=20
```

### Delete

```
action=delete, id="65f84c84"
```

Accepts full UUID or short prefix (min 4 chars).

### Link

```
action=link, from_id="65f84c84", rel=SUPPORTS, to_id="ee460c0c"
action=link, from_id="65f84c84", rel=RELATES_TO, to_id="ee460c0c", note="both affect deploy order"
```

`RELATES_TO` requires `note`. All IDs accept short prefixes.

### Graph: Neighbors

```
action=neighbors, id="65f84c84", depth=2
```

### Graph: PageRank

```
action=pagerank, limit=10
```

Most-referenced memories = most important context.

### Graph: Cypher

```
action=cypher, cypher_query="MATCH (a:Memory)-[r]->(b:Memory) RETURN a.memory_id AS from, r.rel_type AS rel, b.memory_id AS to LIMIT 20"
```

Supported clauses: `MATCH`, `WHERE`, `RETURN`, `ORDER BY`, `LIMIT`, `WITH`. Write operations are rejected.
Use `AS` aliases when returning multiple node properties to avoid key collisions.

---

## Agent Insertion Workflow

1. **Search first** — `action=search` before adding to avoid duplicates
2. **Add** — `action=add` with content, type, optional scope/tags/importance
3. **Check `duplicate_warning`** — score ≥ 0.95: skip or delete the old one
4. **Check `suggested_links`** — for each relevant suggestion, call `action=link` with the appropriate edge type

## Edge Types

| Edge | Directed | Use when |
|------|----------|----------|
| `SUPPORTS` | yes | A confirms or strengthens B |
| `CONTRADICTS` | yes | A conflicts with B |
| `DERIVED_FROM` | yes | A was inferred from B |
| `PRECEDES` | yes | A came before B (causal/temporal) |
| `PART_OF` | yes | A is a component of B |
| `EXEMPLIFIES` | yes | A is a concrete instance of abstract B |
| `INVALIDATES` | yes | A supersedes B (B is outdated) |
| `RELATES_TO` | undirected | Generic — **requires** `note` |

---

## Practical Patterns

### Capture a principle after solving a problem

```
action=add
content="N+1 Query: symptom is slow API, root cause is missing eager loading. Fix: add eager loading. Applies to all ORMs."
type=semantic, scope=debugging, tags="performance,sql", importance=8
```

### Recall context at session start

```
action=search, query="project context", scope=work/acme
action=pagerank, limit=5
```

### Explore what a memory connects to

```
action=neighbors, id="65f84c84", depth=2
action=cypher, cypher_query="MATCH (a:Memory)-[r]->(b:Memory) WHERE a.memory_id = '65f84c84-...' RETURN r.rel_type AS rel, b.memory_id AS to"
```

---

## Importance Scale

- **9-10**: Critical constraints, must-know facts
- **7-8**: Important patterns, significant decisions
- **5-6**: Useful but not critical
- **1-4**: Nice-to-know

Default is 5.

---

## Scopes

Slash-delimited namespaces: `project/component/layer`

Search with `scope=work/acme` prefix-matches all children (`work/acme/backend`, etc.).
