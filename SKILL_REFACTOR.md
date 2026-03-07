# voidm Skill Refactor & Quality Score Display

## Overview
Comprehensive refactor of the voidm agent skill documentation combined with extension enhancement to display memory quality scores inline.

## Skill Documentation Refactor

### Impact
- **Size reduction:** 420 → 95 lines (-77%)
- **Focus:** Essentials-only format for agent clarity
- **Structure:** Quick Start → Memory Types → Tool Actions → Best Practices

### Before → After

**Before (420 lines):**
- 12 subsections with redundant examples
- Verbose explanations of memory concepts
- Detailed parameter listings for each action
- Multiple cautionary sections
- Example-heavy with edge cases

**After (95 lines):**
- Quick Start (2-step workflow)
- Memory Types (concise table: semantic, episodic, procedural, conceptual, contextual)
- Tool Actions (single code block with ALL CLI syntax)
- Don't Store (checklist)
- Quality Guidance (simplified, pattern-focused)
- Best Practices (5 key principles)

### Key Sections

**Quick Start**
```
1. Remember semantically: voidm remember "Concept or decision"
2. Recall contextually: voidm recall "What I need to know"
```

**Memory Types Table**
| Type | Use For | Examples |
|------|---------|----------|
| semantic | Concepts, principles, definitions | "REST APIs are stateless" |
| episodic | Events, decisions, outcomes | "Fixed bug by adding retry logic" |
| procedural | Workflows, steps, commands | "Git merge conflict resolution" |
| conceptual | Frameworks, patterns, theory | "MVC architecture pattern" |
| contextual | Project state, configuration | "This project uses FastAPI" |

**Quality Guidance Simplified**
- ✅ General principles vs specific examples
- ✅ Decision rationale vs task logs
- ✅ Timeless vs temporal content
- ❌ Completed tasks, done/finished references
- ❌ Short fragments, pronouns only

### Rationale
Agent skills should be **concise, scannable, and action-oriented**. Verbose documentation reduces clarity and makes it harder for LLMs to extract essential guidance. 77% reduction focuses on patterns, not edge cases.

## Extension Enhancement: Quality Score Display

### Feature
Display `quality_score` inline in all memory operations (add, search, get).

### Implementation

**Format:**
```
[<id>] (<type>) — Quality: <score>
```

**Example Output:**
```
✓ Added: [3f8c1a2d] (semantic) — Quality: 0.87
  "Concept: Event sourcing enables audit trails"

Found 5 memories:
1. [a1b2c3d4] (semantic) — Quality: 0.92 — "REST APIs are stateless"
2. [e5f6g7h8] (episodic) — Quality: 0.78 — "Fixed auth bug with retry logic"
3. [i9j0k1l2] (procedural) — Quality: 0.81 — "Git merge conflict steps"
```

### Quality Score Thresholds
- **0.9+:** Excellent (well-formed, general, timeless)
- **0.7-0.89:** Good (mostly well-formed, some noise)
- **0.5-0.69:** Fair (task-heavy, temporal elements)
- **<0.5:** Poor (task log, completed items, pronouns)

### Files Modified

**extensions/voidm.ts**
- Added quality_score display in AddMemoryResponse
- Added quality_score display in SearchResult formatting
- Quality shown with 2 decimal places (0.00-1.00 scale)
- Integrated into inline response summaries

## Benefits

### For Agents
- ✅ See quality metric immediately
- ✅ Guided to improve low-quality memories
- ✅ Understand which memories are most reliable
- ✅ Filter by quality in searches

### For Users
- ✅ Understand memory worthiness at a glance
- ✅ Know which memories need refinement
- ✅ See scoring impact in real time
- ✅ Learn patterns of quality (general > specific)

### For System
- ✅ Quality visible across all APIs
- ✅ Soft enforcement via scoring guidance
- ✅ No hard blocks (agent can choose to ignore)
- ✅ Supports Phase 2 persistence (quality_score column in DB)

## Integration with voidm Core

### Dependency Chain
1. voidm-core: Computes quality_score via heuristics
2. voidm-core: Persists quality_score in DB
3. voidm-pi-extension: Displays quality_score inline
4. Agent system prompt: Respects quality < 0.5 as binding retry guidance

### Quality Scoring Formula (5-factor)
- Genericity (0.20): Avoids "I", "my", "today", etc.
- Abstraction (0.20): Concept-level, not task-specific
- Temporal independence (0.25): No time-bound references
- Task independence (0.20): Not "done/completed/finished"
- Content substance (0.15): Min word count, not empty/trivial

## Testing

### Tested Scenarios
- ✅ Display quality on add_memory
- ✅ Display quality on search results
- ✅ Formatting with 2 decimal places
- ✅ Quality filtering works with --min-quality flag
- ✅ Backward compatibility (NULL scores computed on-the-fly)

### Real-World Results
- 345 existing memories: NULL → computed on first retrieval
- New memories: scored at insert, persisted to DB
- High-quality memories (>0.8): General principles, patterns, decisions
- Low-quality memories (<0.5): Task logs, completed items, temporal

## Future Enhancements

### Phase 4: Automatic Cleanup
```bash
voidm memory cleanup --quality-threshold 0.3 --older-than 30d
# Delete memories with score < 0.3 created > 30 days ago
```

### Phase 5: Smart Consolidation
```bash
voidm memory consolidate --quality < 0.5
# Suggest merging low-quality memories into high-quality ones
```

### Phase 6: Scoring Refinement
- User feedback loop: "Mark this memory as low-quality"
- Learn patterns from marked memories
- Refine scoring weights based on agent behavior

## References
- **Quality Scoring:** See voidm/crates/voidm-core/src/quality.rs
- **Skill Philosophy:** "Essence over History" — voidm design principles
- **Agent Integration:** See pi-extension guidelines

