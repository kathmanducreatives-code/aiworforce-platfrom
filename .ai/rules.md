# Cursor AI Rules for ScreeningPilot

## Project Stack
- Frontend: React + Vite
- Styling: Tailwind CSS (utility-first)
- Language: TypeScript
- UI Pattern: dashboard-style SaaS
- State: React hooks (no Redux unless already present)

## Non-negotiable rules
- DO NOT rewrite entire files unless explicitly asked
- DO NOT introduce new libraries without asking
- DO NOT change folder structure
- DO NOT convert Tailwind into CSS files
- DO NOT remove existing functionality

## Editing behavior
- Make minimal, surgical edits
- Prefer editing only the selected JSX block
- Preserve component props and existing logic
- Keep code readable and production-grade

## UI behavior
- Use Tailwind spacing scale consistently (gap-4, p-6, etc.)
- Follow existing layout patterns (cards, grids, panels)
- Do not invent new design systems
- Maintain dashboard consistency

## Output expectations
- Explain what will change BEFORE writing code
- Show diffs when possible
- Ask for confirmation if change impacts multiple files
