# Company Brain v2 — Pending Migration (NOT APPLIED)

Save this as `supabase/migrations/<ts>_company_brain_v2_defaults.sql` **and run via
the migration tool only after review**. It is idempotent.

```sql
BEGIN;

CREATE OR REPLACE FUNCTION public._company_brain_v2_skeleton()
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object(
    'schema_version', 2,
    'setup_status', 'incomplete',
    'brain_confidence', 'weak',
    'target_customer', jsonb_build_object(
      'industries', '[]'::jsonb,
      'business_models', '[]'::jsonb,
      'company_size', jsonb_build_object('min', null, 'max', null, 'label', ''),
      'funding_stage', '[]'::jsonb,
      'geography', '[]'::jsonb,
      'must_have', '[]'::jsonb,
      'nice_to_have', '[]'::jsonb,
      'disqualifiers', jsonb_build_object(
        'industries','[]'::jsonb,'company_types','[]'::jsonb,
        'domains','[]'::jsonb,'keywords','[]'::jsonb,'titles','[]'::jsonb
      )
    ),
    'buyer_personas','[]'::jsonb,'triggers','[]'::jsonb,'jobs_to_watch','[]'::jsonb,
    'competitors','[]'::jsonb,'tools','[]'::jsonb,'pain_points','[]'::jsonb,
    'positive_examples','[]'::jsonb,'negative_examples','[]'::jsonb,'content_angles','[]'::jsonb,
    'qualification_rules', jsonb_build_object(
      'required_evidence','[]'::jsonb,'reject_if','[]'::jsonb,'manual_review_if','[]'::jsonb
    )
  );
$$;

CREATE OR REPLACE FUNCTION public.provision_workspace_for_user(_user_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE existing_id uuid; new_id uuid; display_name text;
BEGIN
  SELECT workspace_id INTO existing_id FROM public.workspace_members
    WHERE user_id = _user_id ORDER BY created_at ASC LIMIT 1;
  IF existing_id IS NOT NULL THEN RETURN existing_id; END IF;

  SELECT COALESCE(NULLIF(p.full_name,''),'My Workspace') INTO display_name
    FROM public.profiles p WHERE p.user_id = _user_id LIMIT 1;
  IF display_name IS NULL THEN display_name := 'My Workspace'; END IF;

  INSERT INTO public.workspaces (name, owner_user_id)
    VALUES (display_name || '''s Workspace', _user_id) RETURNING id INTO new_id;
  INSERT INTO public.workspace_members (workspace_id, user_id, role)
    VALUES (new_id, _user_id, 'owner');
  INSERT INTO public.company_brain (workspace_id, profile)
    VALUES (new_id, public._company_brain_v2_skeleton())
    ON CONFLICT (workspace_id) DO NOTHING;

  RETURN new_id;
END; $function$;

-- Idempotent backfill (existing keys win via `||` precedence)
UPDATE public.company_brain cb
SET profile = public._company_brain_v2_skeleton() || COALESCE(cb.profile,'{}'::jsonb)
WHERE cb.profile IS NULL
   OR NOT (cb.profile ? 'schema_version')
   OR (cb.profile->>'schema_version') <> '2';

COMMIT;
```

## Safety checks
- No table changes; no RLS/GRANT changes needed (`has_workspace_access` already gates `company_brain`).
- Backfill preserves every existing key; only fills missing v2 slots.
- Re-runnable: the `UPDATE` no-ops once `schema_version = 2`.

## Post-migration
No code changes required — the normalizer already reads v2 first and falls back to legacy.
