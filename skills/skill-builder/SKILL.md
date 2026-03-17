---
name: skill-builder
description: Use when someone asks to create a new Codex skill, optimize an existing skill, adapt Claude-style skill docs to Codex, or audit skill quality and triggering behavior.
---

# Skill Builder

Guide the creation and optimization of Codex skills using practical best practices.

For full field references, advanced patterns, and troubleshooting, read [references/reference.md](references/reference.md).

## What Is a Skill?

A skill is a reusable set of instructions that helps Codex handle a specific task reliably.

Use skills for:
- repeated workflows
- domain-specific procedures
- task-specific tool usage
- reusable references, scripts, or assets

Keep project-wide, always-on rules in `AGENTS.md`. Keep task-specific workflows in skills.

## Mode 1: Build a New Skill

Run discovery before writing files unless the user already gave complete details.

### Discovery Rounds

Ask concise questions in small rounds. Skip rounds already answered.

1. Goal and name
- What problem does this skill solve?
- Propose a lowercase hyphenated name under 64 chars.

2. Trigger behavior
- What user phrases should trigger this skill?
- Should it be auto-triggered by Codex description matching, explicit invocation, or both?
- Does it take arguments?

3. Workflow
- What exact steps should Codex follow from trigger to output?
- Which steps need scripts/resources?
- Is this conversational or fire-and-forget?

4. Inputs and outputs
- What inputs are required?
- What output format/location is required?
- Any dependencies or references?

5. Guardrails
- What can go wrong?
- What should the skill never do?
- Any ordering/cost constraints?

6. Confirmation
- Summarize and confirm before building.

Use this summary format:

```markdown
## Skill Summary: [name]

**Goal:** [one sentence]
**Trigger:** [phrases + explicit invocation style]
**Arguments:** [list or "none"]

**Process:**
1. [step]
2. [step]

**Inputs:** [required inputs]
**Outputs:** [deliverables + locations]
**Dependencies:** [scripts/apis/references]
**Guardrails:** [constraints and failure handling]
```

Only proceed after user confirmation, unless they explicitly ask to skip discovery.

### Build Phase

1. Select skill type
- Task skill: step-by-step action workflow.
- Reference skill: standards/guidelines that influence execution.

2. Configure frontmatter
- Use only required fields for Codex skills:
  - `name`
  - `description`
- Put trigger terms in `description`; this is the primary auto-trigger signal.

3. Write SKILL.md body
- Keep it concrete and procedural.
- Prefer numbered workflows for task skills.
- Specify output format and paths.
- Use placeholders like `$ARGUMENTS` or `$0` if explicit invocation passes arguments.

4. Add resources if needed
- `scripts/` for deterministic reusable automation.
- `references/` for detailed docs loaded on demand.
- `assets/` for templates/static files used in outputs.

5. Validate
- Run:
```bash
python3 /Users/prasidha/.codex/skills/.system/skill-creator/scripts/quick_validate.py <path-to-skill>
```
- Fix issues and re-run.

6. Test
- Natural language triggering: verify description coverage.
- Explicit invocation: verify argument substitutions.
- Edge cases: missing or malformed inputs.

## Mode 2: Audit an Existing Skill

Read the full skill before proposing changes.

### Audit Checklist

Frontmatter:
- `name` matches folder name
- `description` is clear, specific, and trigger-oriented

Content quality:
- clear actionable workflow
- deterministic output expectations
- explicit file paths and constraints
- guardrails and edge-case handling

Resource hygiene:
- supporting files are referenced from SKILL.md
- no unnecessary documentation clutter
- scripts are runnable and tested when applicable

Integration:
- skill behavior aligns with project `AGENTS.md`
- no contradiction with project conventions

## Recommended Conventions

- Store skills in `skills/<skill-name>/` for project-local usage.
- Keep SKILL.md focused and concise; move deep details to `references/`.
- Use predictable output locations when skills generate files.
- Never hardcode secrets; use environment variables.

## Notes

- Always inspect existing similar skills before creating duplicates.
- Prefer incremental updates when a near-match already exists.
- For advanced design patterns and troubleshooting, use [references/reference.md](references/reference.md).
