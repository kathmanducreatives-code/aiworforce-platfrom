
# Agent Builder Panel — Implementation Plan

A right-side slide-in panel triggered by "+ New Agent" buttons across the app (sidebar, dock, department rooms). Walks the user through 6 steps to configure and deploy a custom AI agent into their workspace.

---

## 1. Database Migration

**File:** `supabase/migrations/<timestamp>_agent_builder_fields.sql`

Extend the existing `agents` and `agent_capabilities` tables to support custom user-built agents.

```sql
-- agents: add builder fields
ALTER TABLE public.agents
  ADD COLUMN IF NOT EXISTS role_prompt   text,
  ADD COLUMN IF NOT EXISTS tools         text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS trigger_type  text NOT NULL DEFAULT 'on_demand',
  ADD COLUMN IF NOT EXISTS avatar_color  text NOT NULL DEFAULT 'emerald',
  ADD COLUMN IF NOT EXISTS is_default    boolean NOT NULL DEFAULT false;

-- Allow new "operations" department alongside existing four
ALTER TABLE public.agents DROP CONSTRAINT IF EXISTS agents_department_check;
ALTER TABLE public.agents
  ADD CONSTRAINT agents_department_check
  CHECK (department IN ('talent','growth','intelligence','content','operations'));

-- agent_capabilities: add typing + priority fields
ALTER TABLE public.agent_capabilities
  ADD COLUMN IF NOT EXISTS input_type  text,
  ADD COLUMN IF NOT EXISTS output_type text,
  ADD COLUMN IF NOT EXISTS priority    int NOT NULL DEFAULT 1;
```

Existing seeded agents (Aria, Scout, Penn, Hawk, Scribe) will be flagged via a follow-up `UPDATE` to `is_default = true`.

---

## 2. Resolved Spec ↔ Codebase Discrepancies

| Topic | Resolution |
|---|---|
| `workspace_id` (spec hardcodes `…0001`) | Use `useWorkspace().workspaceId` so RLS + multi-tenant isolation continue to work. The hardcoded ID in the spec is treated as illustrative. |
| "Operations" department (not in current enum) | Added to DB constraint + UI maps. Uses a neutral slate ring color. |
| Step count (spec says "5 steps" then lists 6) | Build all **6 steps** as listed in the spec body. |
| Missing `agents` columns | Added via migration above. |
| Missing `agent_capabilities` columns | Added via migration above. |

---

## 3. Data Layer

**File:** `src/lib/orchestration.ts` (extend)

Add a `createAgent` helper that:
1. Inserts the agent row with all builder fields
2. Bulk-inserts the capability rows referencing the new `agent.id`
3. Returns the created `DBAgent`

```ts
export interface CreateAgentInput {
  workspaceId: string;
  name: string;
  department: AgentDept | 'operations';
  rolePrompt: string;
  model: string;
  avatarColor: string;
  tools: string[];
  capabilities: { capability: string; input_type: string; output_type: string }[];
}

export async function createAgent(input: CreateAgentInput): Promise<DBAgent> { /* … */ }
```

Also extend `AgentDept` type to include `'operations'` and add color tokens for it in `agentProfiles.ts`.

---

## 4. UI Components

### Trigger hook
**`src/hooks/useAgentBuilder.ts`** — small zustand-style store exposing `{ open, openBuilder(prefill?), closeBuilder() }` so any component (sidebar, dock, department room) can launch the panel and optionally prefill the department.

### Panel shell
**`src/components/agents/AgentBuilderPanel.tsx`**
- Wraps the existing `SlideOverPanel` (right-side, ~480px desktop, full-width mobile, dark backdrop)
- Holds the wizard state (`formData`, `currentStep`, `errors`)
- Renders the **step progress bar** (6 segments, completed = emerald)
- Footer: `Back` / `Next` buttons, with `Next` becoming **"Deploy Agent"** on step 6
- Validates the current step before allowing `Next`
- On deploy: calls `createAgent`, then swaps body to a **success screen**

### Step components (in `src/components/agents/builder/`)
1. **`Step1Identity.tsx`** — name input + 8-swatch color picker + live `AgentAvatar` preview
2. **`Step2Department.tsx`** — 5 selectable cards (Talent, Growth, Content, Intelligence, Operations) with icon + one-liner
3. **`Step3RolePrompt.tsx`** — large textarea, char counter, 50-char minimum, helper tip
4. **`Step4Model.tsx`** — 4 selectable model cards (`claude-haiku-4-5-20251001`, `claude-sonnet-4-5-20251001`, `gpt-4o`, `gemini-1.5-pro`) using `ModelBadge` icons
5. **`Step5Capabilities.tsx`** — table with rows `{capability, input_type, output_type}`, "Add Row" up to 5, helper text + worked example
6. **`Step6Tools.tsx`** — toggle cards for `web_search`, `firecrawl`, `email_sender`, `slack_notification`, `elevenlabs_voice`; "Skip for now" link
7. **`SuccessScreen.tsx`** — shows new agent avatar, "<Name> is deployed and ready", summary (department, model, capability count, tools enabled), Close button

### Validation
Inline red error messages under each field. `Next`/`Deploy` disabled until step is valid.

| Step | Rule |
|---|---|
| 1 | name required (1–60 chars) |
| 2 | department required |
| 3 | role prompt ≥ 50 chars |
| 4 | model selected |
| 5 | ≥ 1 fully filled capability row (all 3 columns) |
| 6 | optional |

---

## 5. Integration points

- **`src/components/MainLayout.tsx`** — mount `<AgentBuilderPanel />` once at root so any trigger opens it
- **`src/components/Sidebar.tsx`** — add a "+ New Agent" button in the Departments section
- **`src/components/dock/OperativeDock.tsx`** — add a `+` tile at the end of the agent row
- **`src/pages/DepartmentRoom.tsx`** — add a "+ New Agent" button in the room header that prefills `department` for step 2

After deploy, the existing `subscribeAgents` realtime subscription will automatically:
- Add the new agent to the dock
- Make it appear in its department room
- Make it available to the orchestrator via the new `agent_capabilities` rows

---

## 6. Files

**New**
- `supabase/migrations/<ts>_agent_builder_fields.sql`
- `src/hooks/useAgentBuilder.ts`
- `src/components/agents/AgentBuilderPanel.tsx`
- `src/components/agents/builder/Step1Identity.tsx`
- `src/components/agents/builder/Step2Department.tsx`
- `src/components/agents/builder/Step3RolePrompt.tsx`
- `src/components/agents/builder/Step4Model.tsx`
- `src/components/agents/builder/Step5Capabilities.tsx`
- `src/components/agents/builder/Step6Tools.tsx`
- `src/components/agents/builder/SuccessScreen.tsx`
- `src/components/agents/builder/StepProgress.tsx`

**Modified**
- `src/lib/orchestration.ts` (add `createAgent`, extend types)
- `src/data/agentProfiles.ts` (add `operations` dept color tokens)
- `src/components/MainLayout.tsx` (mount panel)
- `src/components/Sidebar.tsx` (+ New Agent trigger)
- `src/components/dock/OperativeDock.tsx` (+ tile)
- `src/pages/DepartmentRoom.tsx` (+ button with department prefill)
