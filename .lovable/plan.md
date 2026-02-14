

## Redesign Screening Invite Flow: AI-Powered 4-Step Wizard

### Overview
Replace the current 4-step screening dialog (Role Briefing, Template Selection, Scenario Coverage, Send Invite) with a new AI-first flow where recruiters describe what they want in plain English, AI generates preview questions, configuration is applied, and the screening is shared via link or email.

### New Step Flow

```text
Step 1: Define Requirements
  - Free-text "What are you looking for?" textarea
  - Role Title input (existing)
  - Industry dropdown (new)
  - Experience Level dropdown (existing)
  - Required Skills / Key Traits checkboxes (existing)
  - Culture Keywords input (new)
        |
        v
Step 2: Preview AI-Generated Questions
  - Auto-call edge function to generate questions
  - Display expandable question cards with category, difficulty
  - "Regenerate Questions" button
  - Inline editing of question text
  - Count badge: "8 questions generated"
        |
        v
Step 3: Configure Interview Settings
  - "How many questions to ask?" slider (5-15, default 8)
  - Question Type checkboxes (Ownership, Skill-based, Culture, Red Flag, Situational)
  - Real-time preview of included questions based on filters
        |
        v
Step 4: Share Screening
  - "Copy Screening Link" with 7-day validity note
  - "Send Email Directly" with candidate dropdown
    - Sources: Resume Screening, ICP Lookalike, LinkedIn Leads
  - Send Invitation Email button
```

### Files to Create

| File | Purpose |
|------|---------|
| `src/components/screening/RequirementsForm.tsx` | Step 1 -- free-text + industry dropdown + existing role fields |
| `src/components/screening/QuestionPreview.tsx` | Step 2 -- AI question preview with expandable cards, regenerate, inline edit |
| `src/components/screening/InterviewSettingsForm.tsx` | Step 3 -- slider, type checkboxes, filtered question preview |
| `src/components/screening/ShareScreening.tsx` | Step 4 -- copy link, candidate selector (multi-source), send email |
| `supabase/functions/generate-screening-questions/index.ts` | New edge function dedicated to question generation (preview-only, no DB save) |

### Files to Modify

| File | Change |
|------|--------|
| `src/components/screening/CreateScreeningDialog.tsx` | Complete rewrite of step logic, state management, and step rendering to use new components |
| `supabase/functions/generate-screening-invite/index.ts` | Accept the pre-generated questions array directly (skip AI call if questions already provided) |
| `supabase/config.toml` | Add new `generate-screening-questions` function entry |

### Detailed Changes

#### 1. New Edge Function: `generate-screening-questions`

A lightweight edge function that calls Lovable AI to generate questions without saving to DB. This enables the "preview" and "regenerate" workflow.

- Accepts: `role_title`, `required_skills`, `experience_level`, `culture_keywords`, `industry`, `free_text_description`
- The free-text description is incorporated into the AI prompt as additional context
- The industry is used to make scenarios industry-specific
- Returns: Array of question objects `{ category, question_text, follow_up_prompts, difficulty_level }`
- Does NOT save to database (that happens in Step 4 via `generate-screening-invite`)
- Uses the same `generateCustomQuestions` logic from the existing edge function but extracted for reuse
- Handles 429/402 errors and returns appropriate error responses

#### 2. `RequirementsForm.tsx` (Step 1)

New component replacing `RoleBriefingForm`:

- Large `Textarea` at top: "What are you looking for in this candidate?" with placeholder example text
- `Input` for Role Title (required)
- New `Select` dropdown for Industry: Technology/SaaS, Healthcare, Finance, Real Estate, Retail, Manufacturing, Consulting, Education, Other
- `Select` for Experience Level (entry/mid/senior -- reuse existing options)
- Key Traits checkboxes grid (reuse existing trait list)
- Optional `Input` for Culture Keywords (comma-separated)
- All fields emit a single `RequirementsData` object via `onChange`

Interface:
```typescript
interface RequirementsData {
  free_text: string;
  role_title: string;
  industry: string;
  experience_level: string;
  required_skills: string[];
  culture_keywords: string[];
}
```

#### 3. `QuestionPreview.tsx` (Step 2)

- On mount (or when requirements change), calls `generate-screening-questions` edge function
- Shows loading skeleton with "AI is generating custom questions..." message
- Displays count badge: "8 questions generated for this screening"
- Each question rendered as an expandable `Collapsible` card showing:
  - Question text (editable via inline Input on click)
  - Category badge (color-coded: accountability=blue, culture_fit=emerald, red_flag=rose, skill-specific=purple)
  - Difficulty level (1-5 dots or stars)
  - Follow-up prompts (collapsed by default)
- "Regenerate Questions" button with RefreshCw icon calls the edge function again
- Edited questions are stored in local state and passed forward

#### 4. `InterviewSettingsForm.tsx` (Step 3)

- Slider component (Radix Slider, already installed): "How many questions to ask?" range 5-15, default 8, shows current value
- Checkboxes for question types to include/exclude:
  - Ownership/Accountability scenarios
  - Skill-based behavioral questions
  - Culture fit questions
  - Red flag detectors
  - Situational judgment tests
- Below the checkboxes, a real-time filtered list showing which questions from Step 2 will be included
  - Questions matching unchecked categories are visually dimmed/struck-through
  - Count updates: "6 of 8 questions will be asked"
- If the slider value exceeds available matching questions, show a note

#### 5. `ShareScreening.tsx` (Step 4)

Two sections:

**Section A: Copy Screening Link**
- Button with Copy icon: "Copy Screening Link"
- Note: "Share this link with your candidate -- it's valid for 7 days."
- Link is generated when step loads (calls `generate-screening-invite` with all accumulated data)

**Section B: Send Email Directly**
- Candidate selector `Select` dropdown that pulls from 3 sources:
  1. `resume_analyses` table: candidates with email (labeled "Resume Screening")
  2. `icp_lookalike_results` table: profiles with email in `profile_data` JSONB (labeled "ICP Lookalike")
  3. `linkedin_leads` table: leads with `contact_email` (labeled "LinkedIn Leads")
- Search/filter within dropdown
- When selected, show candidate name + email card
- "Send Invitation Email" button triggers the edge function with `send_email: true`
- Success toast on send
- Link expiration selector (3/7/14 days)

#### 6. `CreateScreeningDialog.tsx` Rewrite

- Replace `Step` type: `"requirements" | "preview" | "settings" | "share"`
- Replace all step content with the 4 new components
- State management:
  - `requirements: RequirementsData` (from Step 1)
  - `generatedQuestions: GeneratedQuestion[]` (from Step 2, possibly edited)
  - `settings: { questionCount: number, enabledTypes: string[] }` (from Step 3)
  - `selectedCandidate`, `generatedUrl`, etc. (Step 4)
- Step navigation: Next/Back with validation
- Step 1 validation: `role_title` required
- Step 2 validation: at least 1 question generated
- Step 3 validation: at least 1 type enabled and questionCount >= 5
- Step 4: generate link on entry, show sharing options

#### 7. `generate-screening-invite` Update

- Accept new optional param `pre_generated_questions: Array<{...}>` 
- If provided, skip the AI generation call and use these questions directly to create the template and insert questions
- This avoids double AI calls (once for preview, once for save)

### Edge Function Prompt Enhancement

The AI prompt for question generation will be enriched with:
- The free-text description from the recruiter (injected as "Recruiter's expectations" in the user prompt)
- The industry context (e.g., "This role is in the Healthcare industry")
- This makes questions significantly more relevant and role-specific

### Candidate Source Query Strategy

For Step 4's candidate dropdown, three separate queries run on component mount:

1. **Resume Screening**: `SELECT id, candidate_name, email FROM resume_analyses WHERE email IS NOT NULL ORDER BY created_at DESC LIMIT 100`
2. **ICP Lookalike**: `SELECT id, profile_data FROM icp_lookalike_results` -- extract name/email from `profile_data` JSONB where email exists
3. **LinkedIn Leads**: `SELECT id, candidate_name, contact_email FROM linkedin_leads WHERE contact_email IS NOT NULL ORDER BY created_at DESC LIMIT 100`

Results are grouped under labeled sections in the dropdown.

### Mobile Responsiveness

All new components follow the zero-horizontal-scroll policy:
- Textarea and inputs use `w-full`
- Question cards use full width with internal padding `px-4`
- Slider uses `w-full`
- Checkbox grid uses `grid-cols-1 sm:grid-cols-2`
- Candidate dropdown is full width

### Technical Notes

- No new npm dependencies required (Slider, Collapsible, Checkbox all already installed)
- All components use semantic design tokens (`bg-background`, `text-foreground`, `border-border`)
- The dialog max width increases to `sm:max-w-2xl` to accommodate the richer content
- Loading states with `Loader2` spinner and descriptive messages at each async step
- Error toasts for AI generation failures with "Regenerate" retry option
- The `generate-screening-questions` edge function uses `verify_jwt = false` in config.toml (called from authenticated context via supabase client)

