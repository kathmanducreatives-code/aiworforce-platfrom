-- TEST-ONLY Vault stand-in for the provider-connections check. Replaces the
-- lane's empty vault.decrypted_secrets view with a table-backed one and adds
-- vault.create_secret / vault.update_secret with Supabase's signatures. There is
-- NO encryption here; the real Vault encrypts at rest. Never apply to Supabase.
drop view if exists vault.decrypted_secrets;
create table vault.secrets (
  id uuid primary key default extensions.gen_random_uuid(),
  name text unique,
  description text not null default '',
  secret text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create view vault.decrypted_secrets as select id, name, description, secret as decrypted_secret from vault.secrets;
create function vault.create_secret(new_secret text, new_name text default null, new_description text default '', new_key_id uuid default null)
returns uuid language sql as $$
  insert into vault.secrets (secret, name, description) values (new_secret, new_name, new_description) returning id
$$;
create function vault.update_secret(secret_id uuid, new_secret text default null, new_name text default null, new_description text default null, new_key_id uuid default null)
returns void language sql as $$
  update vault.secrets set secret = coalesce(new_secret, secret), name = coalesce(new_name, name),
    description = coalesce(new_description, description), updated_at = now() where id = secret_id
$$;
revoke all on schema vault from public, anon, authenticated;
