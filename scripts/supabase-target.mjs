#!/usr/bin/env node
// SUPABASE CLI, PINNED TO AN EXPLICIT TARGET.
//
// THE FOOTGUN THIS REMOVES.
//
// `supabase/config.toml` named the PRODUCTION project, and nothing else in the
// repo contradicted it. Every CLI command that resolves its project from config
// — `db push`, `link`, `db pull`, `migration list` — therefore aimed at
// production by default, from a developer's ordinary working tree. The only
// thing standing between a routine command and a production write was that the
// CLI account happened to lack access.
//
// config.toml now names TEST. That alone is not enough: a default is a
// convention, and a convention is what people override by accident. This wrapper
// is the structural half — it resolves the target explicitly, hands the CLI an
// explicit `--project-ref`, and fails closed when the two disagree.
//
//   npm run supabase:test -- functions list
//   npm run supabase:test -- secrets list
//
//   SUPABASE_TARGET=production npm run supabase:prod -- functions list
//
// PRODUCTION IS NEVER REACHABLE BY DEFAULT. The prod script refuses to run
// unless `SUPABASE_TARGET=production` is set in the environment, so a mistyped
// script name cannot reach it and neither can a stale shell.
//
// Reuses `verify-deploy-target.mjs` for canonical-ref validation rather than
// re-implementing it, so there is one definition of "which ref is which
// environment".
//
// READ-ONLY IN ITSELF: it validates and then delegates. It deploys nothing and
// migrates nothing on its own.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const CANONICAL = {
  production: "ohsdatpvfdjdemstoiuj",
  test: "ohsdatpvfdjdemstoiuj",
};

/**
 * Commands this wrapper refuses outright, with the reason.
 *
 * `db push` is not merely risky here, it is BROKEN: local migration filenames
 * and the remote history use different version strings for the same migrations,
 * so the CLI believes ~96 migrations are pending and would attempt to re-apply
 * essentially the whole schema. The outreach base migration alone would abort it — its
 * `CREATE TYPE` statements have no `IF NOT EXISTS` and those types already
 * exist. Refusing it here is more honest than documenting a command nobody
 * should run. See docs/SUPABASE_TARGETING.md.
 */
const REFUSED = new Map([
  ["db push", "local and remote migration versions do not correspond; `db push` would attempt ~95 migrations. Apply single migrations through the TEST-pinned MCP channel instead."],
  ["db reset", "destructive; never appropriate against a shared project."],
  ["db pull", "requires a migration-history match this repo does not have; it would rewrite local migrations from a mismatched remote."],
]);

function fail(msg) {
  console.error(`[supabase-target] FAIL: ${msg}`);
  process.exit(1);
}

/** The project ref currently checked into config.toml. */
export function configuredRef(path = "supabase/config.toml") {
  const m = /^\s*project_id\s*=\s*"([a-z0-9]+)"/m.exec(readFileSync(path, "utf8"));
  return m ? m[1] : null;
}

export function environmentOf(ref) {
  if (ref === CANONICAL.production) return "production";
  if (ref === CANONICAL.test) return "test";
  return "unknown";
}

/**
 * Decide the target, fail-closed.
 *
 * `test` is the default because it is the only safe default. Production requires
 * BOTH the explicit script AND `SUPABASE_TARGET=production`; either alone is
 * treated as a mistake, because either alone usually is one.
 */
export function resolveTarget({ requested, env = process.env }) {
  const declared = (env.SUPABASE_TARGET || "").trim().toLowerCase();

  if (requested === "production") {
    if (declared !== "production") {
      return {
        ok: false,
        reason:
          "refusing to target production: set SUPABASE_TARGET=production to confirm. " +
          "A production command must be deliberate in the environment, not just in the script name.",
      };
    }
    return { ok: true, target: "production", ref: CANONICAL.production };
  }

  // Anything else resolves to test — including an unset or misspelled request.
  // Failing UP to production on a typo is the one thing this must never do.
  if (declared === "production") {
    return {
      ok: false,
      reason:
        "SUPABASE_TARGET=production is set but this is the TEST command. " +
        "Refusing rather than silently ignoring the declared target.",
    };
  }
  return { ok: true, target: "test", ref: CANONICAL.test };
}

export function refusalFor(args) {
  const joined = args.filter((a) => !a.startsWith("-")).slice(0, 2).join(" ");
  for (const [cmd, why] of REFUSED) if (joined.startsWith(cmd)) return { cmd, why };
  return null;
}

// ---------------------------------------------------------------- main ----

function main() {
  const requested = (process.argv[2] || "").toLowerCase();
  // npm passes the script's own `--` through before the user's arguments, so a
  // leading separator is npm's, not the CLI's. Forwarding it would make
  // `supabase -- projects list` and lose the subcommand.
  const args = process.argv.slice(3).filter((a, i) => !(i === 0 && a === "--"));

  if (requested !== "test" && requested !== "production") {
    fail("usage: node scripts/supabase-target.mjs <test|production> -- <supabase args>");
  }
  if (args.length === 0) fail("no supabase command given");

  const resolved = resolveTarget({ requested });
  if (!resolved.ok) fail(resolved.reason);

  const refused = refusalFor(args);
  if (refused) fail(`\`supabase ${refused.cmd}\` is not available through this repo.\n  ${refused.why}`);

  // The canonical check, delegated — one definition of which ref is which env.
  execFileSync("node", ["scripts/verify-deploy-target.mjs", "--expect", resolved.target], {
    stdio: "inherit",
    env: { ...process.env, DEPLOY_SUPABASE_PROJECT_REF: resolved.ref },
  });

  // A config.toml that disagrees with the resolved target is a repo-level
  // mistake worth surfacing, not silently overriding.
  const inConfig = configuredRef();
  if (inConfig && environmentOf(inConfig) !== resolved.target) {
    console.warn(
      `[supabase-target] NOTE: config.toml names the ${environmentOf(inConfig)} project ` +
      `(${inConfig}) while this command targets ${resolved.target}. ` +
      `--project-ref is passed explicitly, so the CLI will use ${resolved.ref}.`,
    );
  }

  console.log(`[supabase-target] running: supabase ${args.join(" ")} --project-ref ${resolved.ref}`);
  execFileSync("supabase", [...args, "--project-ref", resolved.ref], { stdio: "inherit" });
}

// Only run when invoked directly, so the helpers above stay importable by tests.
if (import.meta.url === `file://${process.argv[1]}`) main();
