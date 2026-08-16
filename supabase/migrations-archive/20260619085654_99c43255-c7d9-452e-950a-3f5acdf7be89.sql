DROP POLICY IF EXISTS "Conversation logs require active session" ON public.screening_conversation_logs;
DROP POLICY IF EXISTS "Anyone can insert conversation logs" ON public.screening_conversation_logs;
REVOKE INSERT ON public.screening_conversation_logs FROM anon, authenticated;