// Read-only source overlay. Does not checkout, merge, edit or execute other branches.
import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const [launchArg, brainArg] = process.argv.slice(2);
if (!launchArg || !brainArg) throw Error('Usage: node tests/pilot-browser/compat-map.mjs <launch-worktree> <brain147-worktree>');
const launch = realpathSync(launchArg), brain = realpathSync(brainArg);
for (const [path, sha] of [[launch, '8b0e2b6bdb20d6fe30542da39f0170d514d52746'], [brain, 'c9c4859f33c6a346c6380cc1be345dce3f9b4d73']]) {
  if (execFileSync('git', ['-C', path, 'rev-parse', 'HEAD'], {encoding: 'utf8'}).trim() !== sha) throw Error('Compatibility baseline SHA mismatch');
  if (execFileSync('git', ['-C', path, 'diff', 'HEAD', '--', 'supabase/functions/_shared'], {encoding: 'utf8'}).trim()) throw Error('Compatibility product source is dirty');
}
const prefix = pathToFileURL(resolve('supabase/functions/_shared')).href + '/';
const lp = pathToFileURL(resolve(launch, 'supabase/functions/_shared')).href + '/';
const bp = pathToFileURL(resolve(brain, 'supabase/functions/_shared')).href + '/';
const imports = {[prefix]: lp, [prefix + 'pilot/']: prefix + 'pilot/'};
for (const file of ['normalizeCompanyBrain.ts', 'companyBrainContext.ts', 'companyBrainUpdate.ts', 'integrationReadiness.ts']) {
  for (const p of [prefix, lp]) imports[p + file] = bp + file;
}
process.stdout.write(JSON.stringify({imports}, null, 2) + '\n');
