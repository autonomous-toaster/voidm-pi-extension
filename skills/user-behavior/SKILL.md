---
name: user-behavior
description: "Capture and recall user interaction patterns, preferences, and decision-making"
---

# User Behavior Memory — Understand How Users Work

Store and recall user working styles, preferences, and problem-solving patterns to adapt future interactions and anticipate needs.

## Why Capture User Behavior?

- **Anticipate needs**: Recall how user typically approaches similar tasks
- **Adapt communication**: Match user's preferred response format and style
- **Suggest tools**: Recommend based on past preferences (httpx vs requests)
- **Workflow matching**: Align with user's problem-solving approach
- **Build trust**: Demonstrate understanding of user's values and constraints

## Memory Types for User Behavior

| Type | Captures | Example |
|------|----------|---------|
| **contextual** | Priorities, values, what matters | "User prioritizes data quality, flags 0% docs as CRITICAL" |
| **procedural** | Workflow, patterns, how they work | "User: explore → test → analyze → document" |
| **episodic** | Specific situations, reactions, decisions | "Email filtering blocked → tested all variations → adapted" |
| **semantic** | Philosophy, beliefs, principles | "User believes: simple > complex, completeness matters" |

## Quick Capture Patterns

### Working Style (Procedural)
```
action=remember
type=procedural
content="User's workflow: (1) Explore docs/spec first (2) Test all variations 
before concluding (3) Quantify findings with metrics (4) Create comparisons 
to identify patterns (5) Document with recommendations (URGENT/HIGH/MEDIUM)"
importance=9
scope=user
tags=working-style,workflow
```

### Priorities & Values (Contextual)
```
action=remember
type=contextual
content="User priorities: Data quality (flags issues as CRITICAL), Clean 
architecture (rejects overcomplicated solutions), Completeness (doesn't stop 
at first answer), Documentation (detailed reports), Pragmatism (uses workarounds)"
importance=9
scope=user
tags=priorities,values
```

### Technical Preferences (Semantic)
```
action=remember
type=semantic
content="User technical preferences: httpx over requests (modern, async-first), 
uvx over venv (simplicity), no try-except blocks (let libraries handle), 
markdown with tables (structured), GET-only queries (safety)"
importance=8
scope=user
tags=technical-preferences,tools
```

### Communication Style (Contextual)
```
action=remember
type=contextual
content="User communication: Prefers directness (clear specific requests), 
conciseness (brief focused responses), completeness (all relevant info), 
pragmatism (accepts limitations), structured output (tables/bullets), 
curiosity (asks probing questions)"
importance=8
scope=user
tags=communication,style
```

### Decision-Making Framework (Procedural)
```
action=remember
type=procedural
content="User decision framework: Tool selection: (1) Must solve problem 
(required) (2) Simpler than alternatives (preferred) (3) Modern/maintained 
(nice-to-have). Blockers: (1) Test all variations (2) Check documentation 
(3) Adapt approach (4) Document findings"
importance=8
scope=user
tags=decision-making,framework
```

## Recall Patterns

### Before Starting Similar Task
```
action=recall
query="user's approach to API analysis"
scope=user
```

Returns: User's discovery-first approach, testing patterns, quantification habits

### When Suggesting Tools
```
action=recall
query="user technical preferences tools"
scope=user
```

Returns: Tool preferences, why user chooses certain tools

### When Formatting Response
```
action=recall
query="user communication style preferences"
scope=user
```

Returns: Preferred response format, communication patterns

### When User Encounters Blocker
```
action=recall
query="user problem-solving workflow when blocked"
scope=user
```

Returns: User's systematic testing approach, adaptation strategy

## Example: Full User Profile Memory

```
action=remember
type=contextual
content="USER BEHAVIOR PROFILE

WORKING STYLE: Discovery-first (explores docs/spec), comprehensive testing 
(doesn't accept 'not found' at first failure), quantifies findings (%, scores), 
identifies patterns (multiple examples), structured documentation (markdown/tables)

PRIORITIES: Data quality (flags 0% docs as CRITICAL), clean architecture 
(rejects overcomplicated), completeness (doesn't stop at first answer), 
documentation (detailed reports), pragmatism (uses workarounds)

TECHNICAL PREFERENCES: httpx (modern, async), uvx (simplicity), no try-except 
(let libraries handle), markdown tables (structured), GET-only (safety)

COMMUNICATION: Direct (clear requests), concise (brief responses), complete 
(all info), pragmatic (accepts limits), structured (tables/bullets), curious 
(probing questions)

DECISION FRAMEWORK: Tools: must solve → simpler → modern. Blockers: test all 
→ check docs → adapt → document. Constraints: follows strictly, no loopholes.

WORKFLOW: Explore → Test → Analyze → Document → Recommend (URGENT/HIGH/MEDIUM)"
importance=9
scope=user
tags=behavior-profile,complete
```

## Anti-Patterns: What NOT to Store

❌ **Task-specific**: "Fixed auth bug today"
❌ **Time-anchored**: "This session", "yesterday", "2025-03-13"
❌ **Pronouns**: "I did", "we built", "my implementation"
❌ **Temporary**: "TODO-abc done", "sprint goal completed"
✅ **Generic**: "User tests comprehensively before concluding"
✅ **Timeless**: "User prioritizes data quality"
✅ **Reusable**: "User workflow: explore → test → analyze → document"

## Quality Tips

- **Aim for 100+ words** for substance
- **Remove time markers** (today, this session, dates)
- **Remove pronouns** (I, we, my)
- **Write as pattern** not action ("User tests all variations" not "I tested")
- **Include examples** ("User: tested 9 headers + query params")
- **Be specific** ("httpx over requests" not "prefers modern tools")

## Linking User Memories

Connect related behavior memories to build understanding:

```
action=relate
from_id="<working-style-memory>"
rel=SUPPORTS
to_id="<technical-preferences-memory>"
note="User's systematic workflow enables tool selection based on criteria"
```

```
action=relate
from_id="<priorities-memory>"
rel=EXEMPLIFIES
to_id="<communication-style-memory>"
note="Data quality priority shows in how user flags issues as CRITICAL"
```

## Using User Behavior in Responses

### Adapt Format
Recall: "User prefers tables and bullets"
Action: Format response with tables, not prose

### Suggest Tools
Recall: "User prefers httpx over requests"
Action: Recommend httpx for HTTP tasks

### Anticipate Needs
Recall: "User creates comparisons to identify patterns"
Action: Proactively suggest comparison document after multiple analyses

### Match Workflow
Recall: "User: explore → test → analyze → document"
Action: Suggest OpenAPI exploration first, then testing approach

### Respect Constraints
Recall: "User respects constraints strictly"
Action: Trust that "GET only" will be followed, don't suggest POST/PUT

## When to Update User Behavior Memories

- User demonstrates new preference or pattern
- Previous memory contradicted by consistent new behavior
- User explicitly states preference change
- Pattern becomes more pronounced or refined

## When to Delete

- Memory contradicted by consistent new behavior
- User explicitly rejects previous pattern
- Memory becomes outdated (old tool preference replaced)

## See Also

- **memory skill**: Store and recall knowledge with persistent memory tool
- **voidm cli-reference**: Complete CLI command reference
