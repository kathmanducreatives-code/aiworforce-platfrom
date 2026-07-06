## Plan

1. **Repair backend access for chat deletion**
   - Add a database migration granting the app’s authenticated role explicit access to `conversations` and `messages`.
   - Keep the existing ownership policy intact: users can still only delete their own chats.
   - Preserve message cascade deletion so deleting a chat removes its messages from the database too.

2. **Make deletion failures impossible to miss**
   - Keep the existing `.delete().select('id')` checks so the UI only says “deleted” when the database returns deleted row IDs.
   - If the backend still blocks deletion, show a real error instead of a success toast.

3. **Validate the fix**
   - Re-check table grants after the migration.
   - Confirm single and bulk delete use the same verified deletion path.

## Technical details

Current policies are correct (`auth.uid() = user_id` for delete), but the database has **no explicit Data API grants** for `conversations` or `messages`. That means the frontend can appear to run the delete path while the backend may not actually allow the table operation. The fix is to add explicit grants for authenticated users and service access on the relevant chat tables, without widening anonymous access.