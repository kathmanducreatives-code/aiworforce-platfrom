DROP POLICY IF EXISTS "Tracking events require valid scheduled email" ON public.email_tracking;
REVOKE INSERT ON public.email_tracking FROM anon, authenticated;