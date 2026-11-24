#!/usr/bin/env python3
"""Offline agency-only verification; disposable loopback DB/Auth only.

The production bootstrap is unchanged. Temporary copies select the explicit
agency deployment profile: no held client schema or membership RPCs. The held
application membership invariant is independent SQL and remains enforced.
Every assertion is preserved; the profile test also asserts client tables absent.
No flags, migrations or secrets in a hosted environment are touched.
"""
import os
from pathlib import Path
import re
import subprocess
import tempfile

root = Path(__file__).resolve().parents[2]
lane = root / 'tests/db-contract'
paths = []
try:
    for prefix in ['.agency-bootstrap-', '.agency-run-']:
        fd, name = tempfile.mkstemp(prefix=prefix, suffix='.sh', dir=lane)
        os.close(fd)
        paths.append(Path(name))
    boot, runner = paths
    source = (lane / 'bootstrap.sh').read_text()
    source, count = re.subn(r'held_client=\(.*?\n\)', 'held_client=()', source, flags=re.S)
    assert count == 1
    source = source.replace(' "${held_client[@]}"', '')
    source += '\napply "$held/20261025160000_workspace_members_app_surface.sql"\n'
    boot.write_text(source)
    source = (lane / 'run-with-gotrue.sh').read_text().replace('tests/db-contract/bootstrap.sh', 'tests/db-contract/' + boot.name)
    runner.write_text(source)
    for path in paths:
        path.chmod(0o700)
    tests = [
        'agency-no-clients.audit.test.ts',
        'execution-integration-audit.test.ts',
        'task-parent-membership-audit.test.ts',
        'post-insert-revocation-audit.test.ts',
        'plan-recreation-race.audit.test.ts',
    ]
    result = subprocess.run([str(runner), *['tests/outpost-native/' + t for t in tests]], cwd=root)
    raise SystemExit(result.returncode)
finally:
    for path in paths:
        path.unlink(missing_ok=True)
