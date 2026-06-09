# Pilot-chat smoke test run

No code or schema changes. Execute 6 prompts against `pilot-chat` via `curl_edge_functions`, then read DB rows for each invocation.

## Approach

For each prompt I'll:

1. POST to `pilot-chat` with `{ message, conversation_id? }`. Tests 4→continuation reuse the conversation_id returned by test 4 so the people_action is shared.
2. Capture the JSON response (assistant message, plan_id if any, intent).
3. If a plan was created, query the DB:
   - `task_plans` → status, steps, plan_summary
   - `tasks` → status, error_message
   - `tool_calls` → tool_name, input_json.selected_actor_key, input_json.actor_id, status, error, output_json (existence + total/no_results)
4. Wait briefly between query and read so async chain (`run-agent` → `runTool`) has time to write.

## Reporting

Per test: assistant response, plan_id, selected_actor_key, tool_call status + error, result count, output_json present (yes/no), plan status.

Final table summarizing all 6, plus a "ready / blocked" verdict per test.

## Auth

Use the preview-session token injected by `curl_edge_functions` so RLS-scoped reads work. DB introspection uses `supabase--read_query` with service role.

## Limits

- HarvestAPI / Apify Jobs / Firecrawl may take 30–120s to finish. If a tool_call is still `running` when I query, I'll note it and re-query once.
- I will not retry failures or mutate state to "fix" anything during this run — only report.
