

## AI-Powered Custom Question Generation in Screening Invite

### Overview
Enhance the `generate-screening-invite` edge function to accept role-specific parameters and use Lovable AI to generate tailored behavioral screening questions. When custom parameters are provided, the function creates a new template with AI-generated questions before creating the session. When no custom parameters are provided, existing behavior is preserved.

### Flow

```text
Client sends invite request
        |
        v
  Has role_title + required_skills?
       / \
     No    Yes
     |       |
     v       v
  Existing  Call Lovable AI to generate questions
  behavior        |
     |            v
     |     Create screening_template
     |     ("{role_title} Custom Assessment")
     |            |
     |            v
     |     Insert questions into screening_template_questions
     |     (mapped to categories)
     |            |
     |            v
     |     Store role context in session role_briefing
     |            |
     v            v
  Create session (with or without new template_id)
        |
        v
  Continue with webhook, email, etc.
```

### Changes

#### 1. Edge Function: `supabase/functions/generate-screening-invite/index.ts`

**New accepted parameters** (destructured from request body alongside existing ones):
- `role_title` (string, optional)
- `required_skills` (string[], optional)
- `experience_level` (string: "entry" | "mid" | "senior", optional)
- `culture_keywords` (string[], optional)

**New logic block** (inserted after candidate validation, before the n8n webhook call):

1. Check if `role_title` and `required_skills` are both provided (the trigger for custom generation)
2. Call Lovable AI Gateway (`https://ai.gateway.lovable.dev/v1/chat/completions`) using tool calling to extract structured output:
   - Model: `google/gemini-3-flash-preview`
   - System prompt instructs the AI to generate behavioral screening questions in STAR format
   - Tool definition: `generate_screening_questions` with a schema expecting an array of question objects (each with `category`, `question_text`, `follow_up_prompts`, `difficulty_level`)
   - The prompt includes role_title, required_skills, experience_level, and culture_keywords
3. Parse the tool call response to get the generated questions array
4. Create a new `screening_templates` row with:
   - `name`: `"{role_title} Custom Assessment"`
   - `description`: Auto-generated description mentioning the role and skills
   - `role_focus`: `role_title`
   - `is_default`: `false`
5. Insert each generated question into `screening_template_questions` with:
   - `template_id`: the new template's ID
   - `category`: mapped from the AI output (ownership, skill-specific, culture_fit, red_flag)
   - `question_text`, `follow_up_prompts`, `difficulty_level` from AI output
   - `is_custom`: `true`
   - `sort_order`: sequential
6. Set the `template_id` variable to the new template's ID (so the session links to it)
7. Enrich `role_briefing` with the custom parameters so the chat AI can reference them during follow-ups

**Error handling**: If Lovable AI call fails (network error, 429, 402), log the error and fall back to default behavior (no custom questions generated, session still created).

**Question generation prompt structure**:
- 2 ownership/accountability scenarios
- 2-3 questions per required skill (behavioral, probing)
- 1-2 culture-fit questions using culture_keywords
- 1 red-flag detector question
- All questions must be STAR-format friendly, open-ended, and role-specific for the given experience_level

**Category mapping for `screening_template_questions`**:
- Ownership questions map to category `"accountability"`
- Skill questions map to the skill name (e.g., `"leadership"`, `"communication"`)
- Culture questions map to `"culture_fit"`
- Red-flag questions map to `"red_flag"`

(The `screening_template_questions.category` column is a plain `string`, not the enum, so custom category names are supported.)

### Technical Details

| File | Change |
|------|--------|
| `supabase/functions/generate-screening-invite/index.ts` | Add AI question generation logic, new parameters, template creation |

**No database schema changes needed** -- all tables already support the required fields.

**No frontend changes in this task** -- the edge function accepts new optional parameters; existing callers continue to work without them.

### Key Implementation Notes

- Uses `LOVABLE_API_KEY` (already available as a Supabase secret) for the AI gateway
- Uses structured output via tool calling (not raw JSON parsing) for reliable question extraction
- The AI call is non-streaming (single `invoke`-style fetch) since we need the complete response before inserting into DB
- Timeout: 30 seconds for AI call (separate from the n8n webhook timeout)
- If AI generation fails, the function logs the error and proceeds without custom questions (graceful degradation)
