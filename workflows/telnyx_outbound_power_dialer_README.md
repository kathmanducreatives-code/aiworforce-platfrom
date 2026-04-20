# Telnyx Outbound Power Dialer MVP

This workflow is a production-minded single-lead Telnyx power dialer for n8n.

It dials one eligible lead at a time, uses Telnyx Premium AMD, transfers only live humans to `MY_PHONE_NUMBER`, skips non-human outcomes, logs every attempt, and retries only `busy` and `no_answer` by default.

## What It Includes

### Module 1: Lead Intake

- Default lead source is a static test list in the node named `Lead Source - Static Test List`.
- The workflow stores and updates these fields per lead:
  - `id`
  - `name`
  - `phone`
  - `company`
  - `status`
  - `attempts`
  - `last_result`
  - `last_called_at`
- The source adapter is intentionally isolated so you can replace it with Google Sheets, Airtable, Supabase, or another source later.

### Module 2: Call Initiation

- Uses `HTTP Request` to call Telnyx `POST /v2/calls`.
- Sends `connection_id`, `from`, `to`, `webhook_url`, `client_state`, and `answering_machine_detection: premium`.
- Persists Telnyx call identifiers after the API response:
  - `call_control_id`
  - `call_session_id`
  - `call_leg_id`

### Module 3: Webhook Receiver

- Uses `Webhook - Telnyx Events` for live Telnyx callbacks.
- Uses `Normalize Incoming Event` to parse the webhook safely.
- Uses deterministic state plus processed-event tracking to ignore duplicate webhook deliveries.

### Module 4: Outcome Router

- Human outcomes:
  - `human`
  - `human_residence`
  - `human_business`
- Non-human outcomes:
  - `machine`
  - `silence`
  - `fax_detected`
  - `not_sure` is treated conservatively as non-human / do-not-transfer
- Also handles:
  - `busy`
  - `no_answer`
  - `failed`
  - `invalid`
  - `completed`
  - `hung_up`
  - `transfer_failed`

### Module 5: Transfer To Me

- Uses `Telnyx - Transfer To Me` to call:
  - `POST /v2/calls/{call_control_id}/actions/transfer`
- Uses deterministic `command_id` so duplicate human-detection events cannot trigger multiple transfer commands.
- Logs both:
  - transfer command accepted
  - transfer command failed
- Confirms transfer completion when `call.bridged` arrives.

### Module 6: Logging and State Updates

- Default storage backend is `workflow static data` inside n8n.
- Stored state includes:
  - lead status
  - last result
  - attempts
  - timestamps
  - Telnyx call identifiers
  - transfer status
  - processed webhook IDs
- This is the clean swap seam for moving to Supabase, Postgres, Airtable, or another durable backend later.

### Module 7: Retry Logic

- Only retries `busy` and `no_answer` by default.
- Retry settings come from `LEAD_SOURCE_CONFIG`:
  - `maxRetries`
  - `retryDelayMinutes`
- Retries are scheduled by state, not by wait nodes.
- The scheduled trigger simply picks up the next eligible lead when its retry time arrives.

### Module 8: Testing Mode

- Includes `Webhook - Test Event Injector`.
- You can simulate:
  - human answer
  - voicemail / machine
  - busy
  - no answer
  - duplicate webhook delivery
  - transfer failure

## Telnyx Setup

1. Create or use a Telnyx Call Control application / connection.
2. Save the Telnyx connection ID as `TELNYX_CONNECTION_ID`.
3. Use a Telnyx number capable of outbound calling and set it as `TELNYX_FROM_NUMBER`.
4. Make sure your n8n instance is publicly reachable from Telnyx.
5. Activate this workflow in n8n so the production webhook URL is live.

## Webhook URL Setup

Set `N8N_PUBLIC_WEBHOOK_URL` to your public n8n base URL, for example:

```text
https://n8n.example.com
```

The workflow will build the live Telnyx callback URL automatically as:

```text
https://n8n.example.com/webhook/telnyx-power-dialer-events
```

Use that live webhook URL in the Telnyx outbound call requests. The workflow already does this automatically from the env var.

## Where To Set `MY_PHONE_NUMBER`

Set it as an environment variable on the n8n instance:

```text
MY_PHONE_NUMBER=+15551234567
```

That number is used only when a human is detected.

## Lead Source Configuration

The workflow defaults to a static test list. Set `LEAD_SOURCE_CONFIG` to JSON. Example:

```json
{
  "mode": "static",
  "maxBatchSize": 1,
  "maxRetries": 2,
  "retryDelayMinutes": 15,
  "testLeads": [
    {
      "id": "lead-human-1",
      "name": "Human Test Lead",
      "phone": "+15550000001",
      "company": "Acme Human",
      "status": "new",
      "attempts": 0,
      "last_result": null,
      "last_called_at": null
    }
  ]
}
```

To swap the source later:

1. Replace `Lead Source - Static Test List`.
2. Keep the output lead shape identical.
3. Leave the rest of the workflow unchanged.

## Storage Configuration

Default:

```json
{
  "mode": "workflow_static",
  "processedEventTtlHours": 168,
  "maxEventHistoryPerAttempt": 25,
  "maxLogs": 500
}
```

Important:

- `workflow static data` is good for MVP deployment and controlled load.
- For higher scale or stronger durability, swap the storage adapter to Supabase, Postgres, or Redis-backed state.
- Because this workflow uses webhook callbacks across executions, run it as an active workflow, not just in editor test mode.

## Required Environment Variables / Placeholders

Required:

- `TELNYX_API_KEY`
- `TELNYX_CONNECTION_ID`
- `TELNYX_FROM_NUMBER`
- `MY_PHONE_NUMBER`
- `N8N_PUBLIC_WEBHOOK_URL`
- `LEAD_SOURCE_CONFIG`
- `STORAGE_CONFIG`

## How Retries Work

- Initial dial increments `attempts`.
- If the final normalized outcome is `busy` or `no_answer`, the workflow schedules the next retry time.
- The lead is marked `retry_scheduled`.
- The scheduled trigger runs every minute and only dials that lead again once `next_retry_at` is due.
- Retries stop after `maxRetries` additional attempts beyond the first call.

## How To Test

### 1. Import and Activate

1. Import `workflows/telnyx_outbound_power_dialer.json`.
2. Set all env vars.
3. Activate the workflow.

### 2. Run a Real Dial Attempt

1. Use the manual trigger once, or wait for the schedule trigger.
2. Confirm the lead becomes `call_initiated` in workflow static state.

### 3. Test Human Transfer

POST to the test webhook:

```json
{
  "lead_id": "lead-human-1",
  "event_type": "call.machine.premium.detection.ended",
  "event_id": "test-human-1",
  "result": "human_business"
}
```

Expected:

- transfer command is sent
- lead status becomes `transfer_requested`

Then POST:

```json
{
  "lead_id": "lead-human-1",
  "event_type": "call.bridged",
  "event_id": "test-human-bridge-1"
}
```

Expected:

- lead status becomes `transferred`
- `transfer_happened` is true

### 4. Test Voicemail / Machine Skip

```json
{
  "lead_id": "lead-voicemail-1",
  "event_type": "call.machine.premium.detection.ended",
  "event_id": "test-machine-1",
  "result": "machine"
}
```

Expected:

- no transfer
- hangup command requested
- lead marked `machine`

### 5. Test Busy Retry

```json
{
  "lead_id": "lead-busy-1",
  "event_type": "call.hangup",
  "event_id": "test-busy-1",
  "hangup_cause": "user_busy"
}
```

Expected:

- lead marked `retry_scheduled`
- `next_retry_at` populated

### 6. Test No Answer Retry

```json
{
  "lead_id": "lead-no-answer-1",
  "event_type": "call.hangup",
  "event_id": "test-no-answer-1",
  "hangup_cause": "no_answer"
}
```

Expected:

- lead marked `retry_scheduled`
- `next_retry_at` populated

### 7. Test Duplicate Webhook Handling

Send the exact same payload twice, including the same `event_id`.

Expected:

- first event is processed
- second event is logged as duplicate
- no duplicate transfer or hangup command is sent

### 8. Test Transfer Failure

1. Trigger a human detection event first.
2. Before sending `call.bridged`, send:

```json
{
  "lead_id": "lead-transfer-fail-1",
  "event_type": "call.hangup",
  "event_id": "test-transfer-fail-1",
  "hangup_cause": "timeout"
}
```

Expected:

- lead marked `transfer_failed`
- no retry scheduled

## Suggested Next Upgrades After MVP

- Replace workflow static storage with Supabase or Postgres.
- Replace the static lead source with Supabase, Google Sheets, Airtable, or CRM queries.
- Add caller number rotation.
- Add multiple Telnyx numbers and per-campaign routing.
- Add parallel dialing with concurrency limits and lock management.
- Add lead ownership, queueing, and agent assignment.
- Add a dashboard over attempts, outcomes, transfer rate, and retry queue.
- Add webhook signature verification at the reverse proxy or middleware layer.
- Add DNC suppression, business-hours windows, and rate limiting.
- Add CRM sync back into HubSpot, Salesforce, or Supabase.
