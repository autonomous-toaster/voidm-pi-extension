---
name: voidm
description: "voidm CLI command reference for advanced operations and automation"
---

# voidm CLI Reference

Practical CLI guide for direct memory management, graph exploration, and high-signal retrieval.

**Environment**: Set `VOIDM_DB=/custom/path/memories.db` to use non-default database.

---

## Memory Commands

### Add a Memory
```bash
voidm add "Docker separates app from OS" --type semantic --importance 8

# Output:
# Added memory: a1b2c3d4-...
# Type: semantic  Importance: 8
# Quality: 0.85
```

With all options:
```bash
voidm add "Pattern: validate before store" \
  --type semantic \
  --importance 9 \
  --scope project/auth \
  --tags "pattern,testing"
```

### Get a Memory
```bash
voidm get a1b2c3d4 --json

# Output:
# {
#   "id": "a1b2c3d4-...",
#   "content": "Docker separates...",
#   "type": "semantic",
#   "quality_score": 0.85
# }
```

### Search Memories
```bash
voidm search "docker container" --limit 5 --min-score 0.7

# Output:
# [semantic] [a1b2c3d4] imp:8
# Docker separates app from OS dependencies
#
# [episodic] [b2c3d4e5] imp:6 (project/devops)
# Used Docker for microservices in auth service
```

With scope filter:
```bash
voidm search "validation" --scope project/auth --min-score 0.7
```

Search and filter by quality:
```bash
voidm search "testing" --min-quality 0.8 --limit 10
```

**Quality Score** (0.0–1.0): Each memory gets a quality score reflecting content clarity and structure.
- 0.9–1.0: Excellent (well-formed, specific, complete)
- 0.7–0.9: Good (clear intent, proper structure)
- 0.5–0.7: Fair (understandable but could improve)
- < 0.5: Poor (vague or incomplete)

Use `--min-quality` and especially `--min-score` to keep low-signal results out of agent context. Prefer `--min-score 0.7` or higher unless you explicitly want broad recall.

### Delete a Memory
```bash
voidm delete a1b2c3d4 --yes

# Output:
# Deleted memory [a1b2c3d4]
```

### List All Memories
```bash
voidm list --limit 20 --json

# Shows: 20 most recent memories with type, importance, scope, quality
```

---

## Graph Operations

### Link Memories
```bash
voidm link <memory-1> SUPPORTS <memory-2>
voidm link <memory-1> RELATES_TO <memory-2> --note "same subsystem"
```

### Explore Neighbors
```bash
voidm graph neighbors <memory-id> --depth 2
```

### Read-Only Cypher (Neo4j backend)
```bash
voidm graph cypher "MATCH (m:Memory) RETURN m.id as id, m.title as title LIMIT 10"
```

---

## Ontology Relations

Link two memories or memory-to-concept with typed edges:

```bash
# Semantic relations
voidm link memory-1 SUPPORTS memory-2
voidm link memory-1 CONTRADICTS memory-2
voidm link memory-1 DERIVED_FROM memory-2
voidm link memory-1 PRECEDES memory-2
voidm link memory-1 PART_OF memory-2
voidm link memory-1 EXEMPLIFIES memory-2
voidm link memory-1 RELATES_TO memory-2 --note "Reason they relate"

# Memory to concept
voidm ontology link memory-id INSTANCE_OF concept-id

# Concept hierarchy
voidm ontology link concept-1 IS_A concept-2
```

---

## Graph — Explore & Export

### Export Ontology as DOT (Graphviz)
```bash
voidm ontology graph export --format dot > graph.dot
dot -Tsvg graph.dot -o graph.svg

# Generates Graphviz-compatible format for visualization
```

### Export as Interactive HTML
```bash
voidm ontology graph export --format html > graph.html
open graph.html

# Browser-based force-directed graph with search and filtering
```

### Export as JSON
```bash
voidm ontology graph export --format json | jq '.nodes | length'

# Output: 185
# (Shows 185 concept nodes in JSON format)
```

### Export as CSV (Edge List)
```bash
voidm ontology graph export --format csv > edges.csv

# Columns: source_id,source_name,rel_type,target_id,target_name
# For analysis in spreadsheet tools
```

### Query with Cypher (EAV Model)

The graph uses labeled property graph with `:Memory` and `:Concept` labels:

```bash
# Find all instances of a concept
voidm ontology query "MATCH (m:Memory)-[:INSTANCE_OF]->(c:Concept {name: 'JWT'}) RETURN m.content"

# Find concept hierarchy
voidm ontology query "MATCH (c:Concept)-[:IS_A*]->(parent:Concept) RETURN c.name, parent.name"

# Find related memories (transitive)
voidm ontology query "MATCH (m1:Memory)-[:SUPPORTS|DERIVED_FROM|EXEMPLIFIES*]->(m2:Memory) RETURN m1, m2"

# Find contradictions
voidm ontology query "MATCH (m1:Memory)-[:CONTRADICTS]->(m2:Memory) RETURN m1.content, m2.content"

# Find concepts with most instances
voidm ontology query "MATCH (c:Concept)<-[:INSTANCE_OF]-(m:Memory) RETURN c.name, count(m) as count ORDER BY count DESC"
```

---

## Merge History & Rollback

### View Merge History
```bash
voidm ontology concept merge-history

# Output:
# Merge History:
# ──────────────────────────────────
# [batch-id] 1234/5678 | 12 edges | status: completed
#       At: 2026-03-08T09:00:00
```

Filter by status:
```bash
voidm ontology concept merge-history --status failed
voidm ontology concept merge-history --batch batch-id
```

### Rollback a Merge
```bash
voidm ontology concept rollback-merge merge-log-id

# Output:
# ✓ Rolled back merge [abc123]
# ✓ Restored source concept
# ✓ Retargeted 5 edges
```

---

## Statistics & Info

### Show Memory Stats
```bash
voidm stats

# Output:
# Memory Statistics:
# ─────────────────
# Total memories: 345
#   semantic: 120
#   procedural: 85
#   episodic: 95
#   conceptual: 35
#   contextual: 10
#
# Graph Statistics:
# Total concepts: 181
# Total edges: 456
# Average edges per concept: 2.5
```

---

## Configuration

### Default Paths
- Database: `~/.local/share/voidm/memories.db`
- Config: `~/.config/voidm/config.toml`

### Override Database
```bash
VOIDM_DB=/custom/db.sqlite voidm list

# All commands respect VOIDM_DB environment variable
```

---

## Examples

### Complete Workflow
```bash
# 1. Add memories
voidm add "Docker isolates apps from OS" --type semantic --importance 8 --tags docker,containers
voidm add "Kubernetes orchestrates containers at scale" --type semantic --importance 8 --tags kubernetes,containers

# 2. Link memories to each other
voidm link <memory-1> SUPPORTS <memory-2>

# 3. Search with stricter threshold
voidm search "container" --min-score 0.7 --limit 5

# 4. Export graph
voidm graph export --format html > graph.html
```

### Batch Operations
```bash
# Find candidates
voidm ontology concept find-merge-candidates --threshold 0.90 --output plan.json

# Preview merges
voidm ontology concept merge-batch --from plan.json

# Execute
voidm ontology concept merge-batch --from plan.json --execute

# View results
voidm ontology concept merge-history
```

---

## Troubleshooting

**No results on search?**
```bash
# Try lower threshold
voidm search "topic" --min-score 0.5 --min-quality 0.0 --limit 10

# Or broader term, but keep a threshold
voidm search "word" --min-score 0.7 --limit 10
```

**Bad merge?**
```bash
# Find the merge ID from history
voidm ontology concept merge-history | grep <concept>

# Rollback it
voidm ontology concept rollback-merge <merge-id>
```

**See all concepts and their state**
```bash
voidm ontology concept list --json | jq '.[] | {name, edges: .edge_count}'
```

---

## See Also

- **memory** skill: Memory tool usage guide for agents
- **voidm** repo: github.com/autonomous-toaster/voidm
- Cypher docs: Property graph query language

