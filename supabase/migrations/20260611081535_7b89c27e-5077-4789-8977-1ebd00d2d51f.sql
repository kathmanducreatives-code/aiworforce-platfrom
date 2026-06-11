
DROP INDEX IF EXISTS public.accounts_workspace_domain_uniq;
DROP INDEX IF EXISTS public.accounts_workspace_name_uniq;
DROP INDEX IF EXISTS public.contacts_workspace_linkedin_uniq;

CREATE UNIQUE INDEX accounts_workspace_domain_uniq ON public.accounts (workspace_id, domain) WHERE domain IS NOT NULL;
CREATE UNIQUE INDEX accounts_workspace_name_uniq   ON public.accounts (workspace_id, name)   WHERE domain IS NULL;
CREATE UNIQUE INDEX contacts_workspace_linkedin_uniq ON public.contacts (workspace_id, linkedin_url) WHERE linkedin_url IS NOT NULL;
