

## Fix: Always Show Career Timeline and Education Sections

### Problem
Both the Career Timeline (line 381) and Education (line 459) sections use conditional rendering (`profile.work_history && profile.work_history.length > 0`) which hides them entirely when data is empty or null. The user wants placeholder text instead.

### Changes (1 file: `src/pages/ICPCandidateDetail.tsx`)

1. **Career Timeline section (line 381)**: Remove the conditional wrapper so the section always renders. Inside, check if `work_history` has entries — if yes, render the existing timeline; if no, show "No work history available" in muted text.

2. **Education section (line 459)**: Same approach — always render the section card. If `education` has entries, show them; otherwise display "No education information available" in muted text.

### Section order remains:
About -> Match Analysis -> Career Timeline -> Education -> Skills -> Contact

### Technical Detail
- Line 381: Change `{profile.work_history && profile.work_history.length > 0 && (` to just render the card unconditionally, with an internal conditional for content vs placeholder.
- Line 459: Same pattern for education.
- Placeholder text styled as `text-sm text-muted-foreground italic` to match the design system.
