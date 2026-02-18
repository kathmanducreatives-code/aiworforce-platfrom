# Power Dialer — Analysis & Quick-Start Guide

> **All 3 workflows are active and live** on your n8n instance at `https://n8n.prasidha.me`

## System Overview

An automated cold-calling system built with **n8n + Twilio**. It reads leads from a Google Sheet, dials them one by one, uses Twilio's **Answering Machine Detection (AMD)** to route calls, and loops until every lead is called.

---

## Architecture

```
Frontend/API
    │
    │  POST /power-dialer-start  {dialer_secret}
    ▼
[A: Start Loop]  (14 nodes)
    ├── Read sheet → pick next uncalled lead
    ├── Validate E.164 phone & mark DIALING
    ├── POST to Twilio Calls.json
    │     (To, From, Url=/twilio-voice, StatusCallback=/twilio-status, AMD=Enable)
    └── Respond {ok, callSid, to, remaining}

         Twilio rings the lead...
         AMD detects human/machine...

    ▼
[B: Voice Handler]  (10 nodes)  ← Twilio POSTs with AnsweredBy
    ├── human   → Sheet="Answered"  → TwiML <Dial> Agent
    ├── machine → Sheet="Voicemail" → TwiML <Hangup/>
    ├── fax     → Sheet="Fax"       → TwiML <Hangup/>
    └── default → Sheet="Unknown"   → TwiML <Hangup/>

         Call progresses (or ends)...

    ▼
[C: Status Handler]  (7 nodes)  ← Twilio POSTs CallStatus
    ├── Respond 200 immediately
    ├── busy/failed/no-answer/canceled → Update sheet → Wait 2s → Trigger Next
    ├── completed                      → Wait 2s → Trigger Next
    └── queued/ringing                 → Ignore

    "Trigger Next" = POST /power-dialer-start (loop continues)
```

---

## Workflow Details

| Workflow | ID | Nodes | Webhook |
|---|---|---|---|
| **A: Start Loop** | `Nz27mmZUYSurbqY9` | 14 | `POST /webhook/power-dialer-start` |
| **B: Voice Handler** | `9f6xmywYvIKxd85B` | 10 | `POST /webhook/twilio-voice` |
| **C: Status Handler** | `VnejTpv7bJTSLsyy` | 7 | `POST /webhook/twilio-status` |

### A: Start Loop — Nodes
1. **Webhook** — Receives POST trigger
2. **Validate Secret** — Checks `x-dialer-secret` header against `$env.DIALER_SECRET`
3. **Respond - Unauthorized** — Returns 401 if secret is wrong
4. **Read All Leads** — Reads Google Sheet (Cold_call / Sheet1)
5. **Pick Next Lead** — Finds first uncalled row with valid phone, normalizes to E.164
6. **Route Action** — Switch: stopped / complete / ready / fallback
7. **Respond - Stopped** — Returns when STOP flag found
8. **Respond - Complete** — Returns when all leads are called
9. **Mark DIALING** — Updates sheet row to "DIALING"
10. **Call Twilio** — HTTP POST to Twilio Calls.json with AMD enabled
11. **Respond - Call Initiated** — Returns callSid + remaining count
12. **Mark FAILED** — Updates sheet to "FAILED" on Twilio error
13. **Respond - Error** — Returns 500 on failure
14. **Respond - Fallback** — Returns 500 for unexpected state

### B: Voice Handler — Nodes
1. **Webhook** — Receives Twilio voice callback
2. **Switch AnsweredBy** — Routes: human / machine / fax / default
3. **Update Status - Answered** — Sheet → "Answered"
4. **TwiML - Dial Agent** — `<Dial><Number>AGENT_NUMBER</Number></Dial>`
5. **Update Status - VM** — Sheet → "Voicemail"
6. **TwiML - Hangup** (VM) — `<Hangup/>`
7. **Update Status - Fax** — Sheet → "Fax"
8. **Update Status - Unknown** — Sheet → "Unknown"
9. **TwiML - Hangup Fax**
10. **TwiML - Hangup Default**

### C: Status Handler — Nodes
1. **Webhook** — Receives Twilio status callback
2. **Map Status** — Maps CallStatus to action (update_and_next / next_only / ignore)
3. **Respond - OK** — Returns 200 immediately
4. **Route Status** — Switch on action
5. **Update Sheet Status** — Updates Busy/Failed/No Answer/Canceled
6. **Wait 2s** — Prevents rate limiting
7. **Trigger Next Call** — POSTs to Start Loop with secret

---

## Call Status Flow

| Scenario | Voice Handler Sets | Status Handler Sets | Auto-Loops? |
|---|---|---|---|
| Human answers | Answered | — | ✅ |
| Voicemail | Voicemail | — | ✅ |
| Fax | Fax | — | ✅ |
| Busy | — | Busy | ✅ |
| No answer | — | No Answer | ✅ |
| Failed | — | Failed | ✅ |
| Canceled | — | Canceled | ✅ |

---

## Quick-Start Guide (5 Steps)

### Step 1: Set Environment Variables
Go to **n8n Settings → Variables** and set:

| Variable | Example |
|---|---|
| `TWILIO_ACCOUNT_SID` | `AC51c2b9fe...` |
| `TWILIO_FROM_NUMBER` | `+16509771911` |
| `AGENT_NUMBER` | `+9779802050930` |
| `BASE_URL` | `https://n8n.prasidha.me` |
| `DIALER_SECRET` | Any random secret string |

### Step 2: Prepare Your Google Sheet
Sheet: `Cold_call` (ID: `1ua0YBWKOKgQQfJ_zUy6RmFHZUz9xY8p3nMh2WeMe56c`)

Required columns:
- **`phone`** — E.164 format (e.g. `+16505551234`)
- **`First Name`** — Lead name
- **`Call_Status`** — Leave **empty** for uncalled leads
- **`Last_Called`** — Auto-filled by workflow
- **`Dialer_Status`** — Set to `STOP` on row 1 to pause

### Step 3: Verify Workflows Are Active
All 3 are currently active — no action needed.

### Step 4: Start Dialing
```bash
curl -X POST https://n8n.prasidha.me/webhook/power-dialer-start \
  -H "x-dialer-secret: YOUR_SECRET" \
  -H "Content-Type: application/json" \
  -d '{}'
```

The system **auto-loops** through all leads. Each call triggers the next automatically.

### Step 5: Stop the Dialer
Set row 1's `Call_Status` or `Dialer_Status` to **`STOP`** in the Google Sheet. The dialer will halt after the current call completes.

---

## Testing Checklist

1. **Dry run** — Set `Dialer_Status: STOP`, fire curl → expect `"stopped"` response
2. **All called** — Fill all `Call_Status`, fire curl → expect `"complete"` response
3. **Single live call** — Add 1 test row, answer your phone → expect "Connecting to Screening Pilot"
4. **Voicemail test** — Set phone to DND → expect `Voicemail` in sheet
5. **No secret** — Fire curl without header → expect `401 Unauthorized`

---

## Key Design Decisions
- **3 workflows** → fast webhook responses, no timeout risk
- **Sync AMD** → AnsweredBy arrives with the voice webhook (no race condition)
- **Respond-first** in Status Handler → Twilio gets 200 instantly
- **Shared secret** → prevents unauthorized triggers
- **Call recording** enabled on human calls (dual-channel)

## Known Limitations
1. No Twilio signature validation (add HMAC for production)
2. No concurrent-call lock (multiple triggers = parallel calls)
3. Google Sheets as DB — consider Supabase for 50+ leads
4. Recordings enabled but not auto-retrieved
