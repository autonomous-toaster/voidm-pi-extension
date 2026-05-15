---
name: voidm
description: "voidm CLI command reference for advanced operations and automation"
---

# voidm CLI Reference

Practical CLI guide for direct memory management, graph exploration, and high-signal retrieval.

**Environment**: Set `VOIDM_BIN` to override binary path if not in `~/.local/bin/voidm`.

---

## Memory Commands

### Add a Memory
```bash
voidm add "Docker separates app from OS" --type semantic --importance 8

# Output:
# Added memory: a1b2c3d4-...
# Type: semantic  Importance: 8
```

With all options:
```bash
voidm add "Pattern: validate before store" \
  --type semantic \
  --importance 9 \
  --scope project/auth \
  --tags "pattern,testing" \
  --provenance session \
  --context gotcha \
  --title "Validation before storage"
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

Search modes:
```bash
voidm search "docker" --mode bm25        # pure keyword
voidm search "docker" --mode fuzzy       # typo-tolerant
voidm search "docker" --mode semantic    # vector similarity
voidm search "docker" --mode vector      # chunk-level ANN
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

### Unlink Memories
```bash
voidm unlink <memory-1> RELATES_TO <memory-2>
```

### Explore Neighbors
```bash
voidm graph neighbors <memory-id> --depth 2
```

### Find Shortest Path
```bash
voidm graph path <from-id> <to-id>
```

### Read-Only Cypher (Neo4j backend)
```bash
voidm graph cypher "MATCH (m:Memory) RETURN m.id as id, m.title as title LIMIT 10"
```

---

## Maintenance

### Repair Data Quality
```bash
voidm repair --orphans-only

# Output:
# ✓ Removed 3 orphaned chunk(s)
```

Runs silently on every session start via the extension. Fast, no model loading.

---

## Statistics & Info

### Show Memory Stats
```bash
voidm stats

# Output:
# Memories:  345 total
#   semantic: 120
#   procedural: 85
#   episodic: 95
#   conceptual: 35
#   contextual: 10
#
# Scopes:  42
# Graph:   5240 nodes, 8150 edges
#   MENTIONS      2750
#   HAS_TAG       2720
#   HAS_CHUNK     1270
```

---

## Configuration

### Default Paths
- Database: Neo4j bolt://localhost:7687 (configured in `~/.config/voidm/config.toml`)
- Config: `~/.config/voidm/config.toml`

### Override Config
```bash
VOIDM_CONFIG=/custom/path.toml voidm list
```

---

## Examples

### Complete Workflow
```bash
# 1. Add memories
voidm add "Docker isolates apps from OS" --type semantic --importance 8 --tags docker,containers
voidm add "Kubernetes orchestrates containers at scale" --type semantic --importance 8 --tags kubernetes,containers

# 2. Link memories
voidm link <memory-1> SUPPORTS <memory-2>

# 3. Search with stricter threshold
voidm search "container" --min-score 0.7 --limit 5

# 4. Explore graph
voidm graph neighbors <memory-id> --depth 1
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

**Link/unlink failing?**
```bash
# Check existing edges
voidm graph neighbors <memory-id> --depth 1
```

---

## See Also

- **memory** skill: Memory tool usage guide for agents
- **voidm** repo: github.com/autonomous-toaster/voidm
- Cypher docs: Property graph query language
