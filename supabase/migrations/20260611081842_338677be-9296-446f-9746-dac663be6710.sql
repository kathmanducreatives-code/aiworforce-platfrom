
DROP INDEX IF EXISTS public.accounts_workspace_domain_uniq;
DROP INDEX IF EXISTS public.accounts_workspace_name_uniq;
DROP INDEX IF EXISTS public.contacts_workspace_linkedin_uniq;
DROP INDEX IF EXISTS public.lc_dedupe_uniq;

CREATE UNIQUE INDEX accounts_workspace_name_uniq    ON public.accounts (workspace_id, name);
CREATE UNIQUE INDEX contacts_workspace_linkedin_uniq ON public.contacts (workspace_id, linkedin_url);
