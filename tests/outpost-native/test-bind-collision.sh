#!/usr/bin/env bash
# Real occupied TCP listener returns HTTP 200, but not the disposable DB nonce.
# Every integrated child must recover its pre-test bind failure, never use this
# listener as readiness or retry a security assertion. No app/provider retries.
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
probe_dir="$(mktemp -d "${TMPDIR:-/tmp}/outpost-bind-test.XXXXXX")"
holder=""
cleanup() {
  if [ -n "$holder" ]; then kill "$holder" 2>/dev/null || true; wait "$holder" 2>/dev/null || true; fi
  rm -rf "$probe_dir"
}
trap cleanup EXIT
python3 -u - "$probe_dir/port" <<'PY' >"$probe_dir/http.log" 2>&1 &
import http.server,sys
class Occupied(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b'"not-this-disposable-database"')
    def log_message(self,*args):
        pass
server=http.server.HTTPServer(('127.0.0.1',0),Occupied)
with open(sys.argv[1],'w') as file:
    file.write(str(server.server_port))
server.serve_forever()
PY
holder=$!
for _ in $(seq 1 40); do
  kill -0 "$holder" 2>/dev/null || { cat "$probe_dir/http.log" >&2; exit 1; }
  [ -s "$probe_dir/port" ] && break
  sleep 0.1
done
[ -s "$probe_dir/port" ] || { echo 'collision fixture did not start' >&2; exit 1; }
export OUTPOST_NATIVE_FIRST_REST_PORT="$(cat "$probe_dir/port")"
"$root/tests/outpost-native/integrate-brain-owner.sh" 2>&1 | tee "$probe_dir/integration.log"
count="$(grep -c 'Local REST bind collision; choosing a new port before tests' "$probe_dir/integration.log" || true)"
# Five distinct fresh native lanes, each beginning with the occupied port.
if [ "$count" -lt 5 ]; then echo 'Not every native lane detected the real occupied listener' >&2; exit 1; fi
echo 'BIND_COLLISION_PROOF=PASS; five native lanes used their own database, not a foreign HTTP 200'
