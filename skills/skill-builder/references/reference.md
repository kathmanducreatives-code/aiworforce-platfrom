# Skill Builder Reference (Codex Adaptation)

Complete technical reference for designing and maintaining Codex skills. This reference is adapted from Claude-oriented documentation and rewritten for Codex usage patterns.

Source inspiration: https://code.claude.com/docs/en/skills

## AGENTS.md vs Skills

Where instructions live determines behavior:

| | AGENTS.md | Skill |
|---|---|---|
| When loaded | Every conversation | When selected/triggered |
| Purpose | Project-wide rules and conventions | Task-specific workflows |
| Size concern | Keep tight; always in context | Keep concise; load detailed docs on demand |
| Examples | Coding conventions, test policy | PR summary, report generation, deployment runbook |

Rule of thumb:
- If Codex should always know it, put it in `AGENTS.md`.
- If Codex only needs it for a specific task, create a skill.

## Frontmatter in Codex Skills

Codex skill matching relies on:
- `name`
- `description`

Recommended minimal frontmatter:

```yaml
---
name: my-skill
description: Use when someone asks to ...
---
```

Guidance:
- keep names lowercase with digits/hyphens
- keep descriptions specific enough to trigger correctly
- place trigger language in description, not only in body

## Invocation Behavior

Codex can use a skill when:
- the user explicitly names or references the skill
- the user request semantically matches the skill description

Practical trigger advice:
- include 2-4 natural request variants in the description wording
- avoid overly broad descriptions that cause false positives

## Substitutions and Arguments

When a workflow supports invocation arguments, use placeholders in instructions:
- `$ARGUMENTS` for the full argument string
- `$ARGUMENTS[N]` or `$N` for positional values

Example:

```yaml
---
name: migrate-component
description: Use when someone asks to migrate a component between frameworks.
---

Migrate `$0` from `$1` to `$2` while preserving behavior and tests.
```

## Skill Location Patterns

Common project-local layout:

```text
skills/
  my-skill/
    SKILL.md
    references/
    scripts/
    assets/
```

Notes:
- Keep each skill self-contained.
- Name folder exactly as skill `name`.

## Resource Design

### scripts/

Use for deterministic operations repeated across tasks.

Examples:
- schema transformation
- batch file conversion
- report post-processing

### references/

Use for detailed documentation loaded only when needed.

Examples:
- API schemas
- policy docs
- domain playbooks

### assets/

Use for templates/static resources consumed by output.

Examples:
- document templates
- images/icons
- starter code scaffolds

## Progressive Disclosure

Use three levels:
1. Metadata (`name` + `description`) always visible
2. SKILL.md body loaded only when skill is used
3. references/scripts/assets loaded only when needed

Keep SKILL.md concise and move heavy details to `references/`.

## Advanced Patterns

### Dynamic context injection

If your environment supports command-preprocessing patterns, inject only high-value runtime context (diffs, file lists, statuses). Keep command usage explicit and minimal.

### Subagent/delegation patterns

Use isolated/delegated execution only when:
- the task is self-contained
- verbose work should stay out of primary context
- the expected output is clearly defined

Avoid delegation for workflows that require ongoing user back-and-forth.

### Hooks and lifecycle automation

Where supported, use hook-like checks for:
- pre-execution validation
- post-edit lint/test checks

Keep hook logic deterministic and fast.

## Quality Checklist

Frontmatter:
- name is normalized and stable
- description includes practical trigger phrases

Workflow quality:
- numbered, explicit steps
- explicit output format and destination
- clear constraints and non-goals

Reliability:
- scripts tested on representative inputs
- errors handled with actionable fallback behavior

Maintainability:
- no duplicated guidance across files
- reference docs organized by domain/variant
- no unnecessary auxiliary docs

## Troubleshooting

Skill not triggering:
1. tighten/add trigger keywords in description
2. test with realistic request phrasing
3. verify there is no naming mismatch

Skill triggers too often:
1. narrow description scope
2. remove broad generic language

Arguments not substituting as expected:
1. ensure placeholders are present in body
2. test empty and multi-token arguments

Skill output is inconsistent:
1. make steps more deterministic
2. add explicit output template
3. move fragile logic into scripts

## Validation and Iteration Loop

1. Build or update the skill
2. Validate structure:

```bash
python3 /Users/prasidha/.codex/skills/.system/skill-creator/scripts/quick_validate.py <path-to-skill>
```

3. Test real prompts and edge cases
4. Refine description triggers and workflow precision
5. Repeat until behavior is reliable
