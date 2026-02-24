# n8n Bulk Scheduling Logic - Pseudo/Node Schema

## Trigger: Webhook (POST)
Endpoint: `https://n8n.prasidha.me/webhook/schedule-linkedin`

## Input Schema (from CCC)
```json
{
  "posts": [
    {
      "id": "uuid",
      "caption": "string",
      "scheduledTime": "HH:mm",
      "media": "base64 (optional)",
      "mediaType": "image|video",
      "format": "Carousel|Hot Take|etc"
    }
  ],
  "supabaseUrl": "...",
  "supabaseKey": "..."
}
```

## n8n Workflow Steps:
1. **Webhook Node**: Receives the array of posts.
2. **Code Node (Split & Format)**:
   - For each post, calculate the `targetTimestamp` based on current date + `scheduledTime`.
   - If Day 1 is today, Day 2 is tomorrow, etc. (Index-based date offsetting).
3. **Loop/Split In Batches**:
   - For each post:
     a. **LinkedIn API / Buffer / n8n Post Node**: Create the scheduled post.
     b. **Supabase Update Node**: 
        - Update `linkedin_posts` set `status = 'Posted'` (or 'Scheduled' if you add that state).
        - Save the LinkedIn Post ID for tracking.
4. **Final Response**: Return success/failure count to CCC.
