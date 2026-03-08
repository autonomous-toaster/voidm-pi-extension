---
name: memory
description: "Store and recall knowledge across sessions with persistent memory tool"
---

# Memory Tool — Persistent Knowledge

Use the `memory` tool to store facts, recall context, and build a searchable knowledge graph. Hybrid search (vector + BM25 + fuzzy), quality scoring, and lightweight ontology.

## The Workflow

1. **Recall before task**: `action=recall, query="<topic>"`
2. **During task**: Create concepts if needed with `action=concept_add`
3. **After task**: Store lessons with `action=remember`
4. **Link knowledge**: Connect related memories with `action=relate`

## Quick Start

### Recall Knowledge
```
action=recall
query="<topic or tech>"
scope="project/name"    # Optional: filter by scope
limit=5                 # Optional: max results
```

Returns memories + matching concepts. Try broader queries if no results.

### Store Knowledge
```
action=remember
content="<principle or lesson>"
type=semantic           # semantic | procedural | conceptual | episodic | contextual
importance=8            # 1-10 (default 5)
scope="project/auth"    # Optional: organize by scope
tags="pattern,cache"    # Optional: comma-separated tags
```

Quality score (0.0-1.0) returned. < 0.5 = retry with better content.

### Link Memories
```
action=relate
from_id="memory-1"
rel=SUPPORTS            # SUPPORTS | CONTRADICTS | DERIVED_FROM | PRECEDES | PART_OF | EXEMPLIFIES | RELATES_TO
to_id="memory-2"
note="why they relate"  # Required for RELATES_TO only
```

### Delete Bad Memory
```
action=delete
memory_id="bad-id"
```

### Create Concept (Ontology)
```
action=concept_add
name="AuthService"
description="JWT tokens and session validation"
scope="project/auth"    # Optional
```

### Link Memory to Concept
```
action=link_to_concept
memory_id="mem-id"
id="concept-id"
```

Now recalls of "AuthService" show all linked memories.

### Get Concept Details
```
action=concept_get
id="concept-id"
```

Returns name, description, hierarchy (IS_A), and linked instances.

## Memory Types

| Type | Use Case | Example |
|------|----------|---------|
| **semantic** | Timeless principles, rules, patterns | "Decouple validation from storage for testability" |
| **procedural** | Step-by-step workflows, checklists | "Deploy: test → build → deploy → verify" |
| **conceptual** | Architectural decisions, trade-offs | "Why separate auth from validation: enables testing without DB" |
| **episodic** | Lessons from specific projects/events | "Auth service: learned importance of separation in prod" |
| **contextual** | Project-specific facts, conventions, URLs | "Project X: JWT 1hr expiry, secure cookie, refresh endpoint" |

## Quality Score Guidance

Server computes quality (0.0-1.0) based on: genericity, abstraction, temporal independence, task independence, substance.

| Score | Guidance |
|-------|----------|
| < 0.5 | **Retry**: Remove temporal markers, make more generic, remove "I"/"we" |
| 0.5-0.7 | **Acceptable**: Okay to store, consider refining |
| ≥ 0.7 | **Good**: Trust this memory |

**Bad** (0.35): "Today I fixed auth bug. Task done."
**Good** (0.82): "Auth separation: validation independent from storage/expiry enables testing and reuse."

### How to Improve Quality

- Remove task markers: ❌ "Fixed X", ❌ "TODO-abc done"
- Remove time anchors: ❌ "today", ❌ "yesterday", ❌ "this session"
- Remove pronouns: ❌ "I did", ❌ "we built", ❌ "my implementation"
- Abstract from action: "Pattern: validate before storage" (not "I validated")
- Add context: "Testing independent of storage enables..."
- Aim for 50+ words for substance

## Best Practices

1. **Search before storing** — use `recall` to avoid duplicates
2. **Use scopes** — `scope="project/auth"` keeps memories organized
3. **Link related memories** — creates knowledge graph, helps discovery
4. **Be generous with importance** — 8-10 for critical, 1-3 for nice-to-know
5. **Define concepts** — create for major services/modules, link instances
6. **Respect quality < 0.5** — it's a retry signal, rewrite for genericity

## Examples

### Pattern Storage
```
action=remember
content="Testing strategy: move validation outside service layer so tests don't need database"
type=semantic
importance=9
scope="project/auth"
tags="testing,patterns"
```

### Checklist Storage
```
action=remember
content="Auth release: (1) security tests (2) check expiry (3) update docs (4) deploy"
type=procedural
importance=8
scope="project/auth"
tags="checklist"
```

### Search for Pattern
```
action=recall
query="validation testing"
scope="project/auth"
limit=3
```

### Create Architecture Concept
```
action=concept_add
name="JWT"
description="Stateless auth using JSON Web Tokens with 1hr expiry"
scope="project/auth"
```

### Link Memory to Concept
```
action=link_to_concept
memory_id="<memory-id>"
id="<jwt-concept-id>"
```

### Connect Two Memories
```
action=relate
from_id="<testing-memory-id>"
rel=SUPPORTS
to_id="<separation-memory-id>"
note="Separated validation enables independent testing"
```

## Debugging

**No recall results?**
- Try single keywords instead of phrases
- Check scope filter isn't too narrow
- Use broader query

**Quality score too low?**
- Remove "I", "we", "my"
- Skip time references: "today", "yesterday"
- Write as principle, not action
- Add more substance (50+ words)

**Want to browse all memories?**
- Use `/memories` command in pi for interactive TUI browser

## See Also

- **voidm cli-reference** skill: Complete CLI command reference for humans
- **voidm** repo: github.com/autonomous-toaster/voidm
