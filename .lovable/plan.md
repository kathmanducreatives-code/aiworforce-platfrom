# Phase 1 Deploy + Live Test Plan

Scope is strictly limited: deploy one edge function, run 10 curl tests, report results. No schema, UI, secrets, or production changes.

## Step 1 — Deploy

Deploy only `pilot-chat` via `supabase--deploy_edge_functions` against the current (safe test) project `wqnigjhcwjxtmordrwno`. No other functions touched.

## Step 2 — Run 10 live prompts

For each prompt, call `supabase--curl_edge_functions` POST `/pilot-chat` with the user message, capture the assistant response, then query `messages`, `task_plans`, `tasks`, `tool_calls`, and `approvals` (read-only via `supabase--read_query`) for the resulting conversation to extract:

- `workflow_category` (from `messages.metadata`)
- `selected_actor_key` (from plan/task metadata)
- plan created? (row in `task_plans`)
- tool_calls created? (rows in `tool_calls`)
- approval created? (row in `approvals`)

Prompts:
1. "Write a LinkedIn post about what we shipped this week." → expect `content_creation`
2. "What changed in the AI sales automation market today?" → expect `market_research`
3. "Find me leads for Agentory." → expect `signal_sourcing` + clarification
4. "Analyze https://stripe.com/jobs." → expect `url_analysis`
5. "Find personal phone numbers for 50 founders and start calling them automatically." → expect `unsafe_or_unsupported`
6. "Find companies hiring GTM roles in the US." → expect `company_hiring_sourcing` + `apify_jobs`
7. "Find 10 individual React developer profiles in London." → expect `people_sourcing`
8. "What is Penn working on?" → expect `agent_management`
9. "What approvals are pending?" → expect `approval_review`
10. "Can you help with this?" → expect `unclear`

Each test uses a fresh conversation to isolate routing.

## Step 3 — Regression checks

Explicitly verify across the 10 runs:
- No content_creation/market_research/unsafe/agent_management prompt produced rows in `tool_calls` for Apify actors.
- Prompt #6 still produces `apify_jobs` tool_call (existing Apify Jobs flow intact).

## Step 4 — Report

Table per prompt: response snippet, `workflow_category`, plan created, `selected_actor_key`, tool_calls count, approval, pass/partial/fail, issue note. Then regression summary. Then wait for production-deploy approval.

## Out of scope

No production deploy. No edits to any file. No schema migration. No secret changes. No UI changes. If a test fails, I will report only — no fix-and-redeploy without your approval.
