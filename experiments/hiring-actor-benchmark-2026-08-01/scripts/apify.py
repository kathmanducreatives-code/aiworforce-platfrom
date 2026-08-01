"""Minimal Apify REST helper. Uses curl (python has no CA bundle here).
NEVER writes the token to any artifact."""
import json, os, subprocess, urllib.parse

def _tok():
    t = os.environ.get("APIFY_TOKEN")
    if not t:
        raise SystemExit("APIFY_TOKEN not in env")
    return t

def call(path, method="GET", body=None, timeout=900):
    url = f"https://api.apify.com/v2/{path.lstrip('/')}"
    sep = "&" if "?" in url else "?"
    url = f"{url}{sep}token={urllib.parse.quote(_tok())}"
    cmd = ["curl", "-sS", "-m", str(timeout), "-X", method, url,
           "-H", "Content-Type: application/json", "-w", "\n__HTTP__%{http_code}"]
    if body is not None:
        cmd += ["-d", json.dumps(body)]
    out = subprocess.run(cmd, capture_output=True, text=True).stdout
    raw, _, code = out.rpartition("\n__HTTP__")
    try:
        return json.loads(raw), int(code or 0)
    except Exception:
        return {"__raw__": raw[:2000]}, int(code or 0)

def redact(s):
    """Strip anything token-shaped before persisting."""
    t = os.environ.get("APIFY_TOKEN", "")
    return s.replace(t, "<REDACTED>") if t else s
