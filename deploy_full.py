#!/usr/bin/env python3
"""Full Netlify deploy: site files (digest flow) + tinyquest function.
Replicates what `netlify deploy --prod` does, via the API."""
import json, sys, os, hashlib, urllib.request, urllib.error, time

sys.path.insert(0, "/opt/muse/skills/custom-connector-setup/bin")
from dynamic_credentials import add_surrogate_to_request, read_json_response

SITE = "bb5dab07-70b1-4a09-a34c-46a481680315"
ROOT = "/home/hatch/workspace/arcade"
FN_ZIP = "/tmp/fnzips/tinyquest-manual.zip"
API = "https://api.netlify.com/api/v1"

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args):
        raise RuntimeError("redirect refused")

def api(method, path, body=None, ctype="application/json"):
    req = urllib.request.Request(API + path, method=method, data=body,
        headers={"Content-Type": ctype} if body else {})
    add_surrogate_to_request(req, "custom.netlify", allowed_hosts=["api.netlify.com"])
    with urllib.request.build_opener(NoRedirect()).open(req, timeout=300) as resp:
        ct = resp.headers.get("Content-Type", "")
        raw = resp.read()
        return json.loads(raw.decode()) if "json" in ct else raw

def sha1_of(path):
    h = hashlib.sha1()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()

# 1. hash site files
files, shas = {}, {}
for dirpath, dirnames, filenames in os.walk(ROOT):
    dirnames[:] = [d for d in dirnames if d not in ("node_modules", ".git", "functions")
                   or dirpath != os.path.join(ROOT, "netlify")]
    # skip netlify/functions entirely
    if "netlify/functions" in dirpath:
        continue
    for fn in filenames:
        full = os.path.join(dirpath, fn)
        rel = os.path.relpath(full, ROOT)
        if rel.startswith("netlify/functions"):
            continue
        s = sha1_of(full)
        files["/" + rel] = s
        shas[s] = full
print(f"hashed {len(files)} site files")

fn_sha = hashlib.sha256(open(FN_ZIP, "rb").read()).hexdigest()

# 2. create deploy
d = api("POST", f"/sites/{SITE}/deploys", json.dumps({
    "files": files,
    "functions": {"tinyquest": fn_sha},
    "async": True,
}).encode())
did = d["id"]
print("deploy:", did, d["state"])
req_files = d.get("required", [])
req_fns = d.get("required_functions") or []
print(f"need {len(req_files)} files, {len(req_fns)} functions")

# 3. upload missing site files
for s in req_files:
    path = [p for p, h in files.items() if h == s][0]
    data = open(shas[s], "rb").read()
    req = urllib.request.Request(
        f"{API}/deploys/{did}/files{path}", method="PUT", data=data,
        headers={"Content-Type": "application/octet-stream"})
    add_surrogate_to_request(req, "custom.netlify", allowed_hosts=["api.netlify.com"])
    with urllib.request.build_opener(NoRedirect()).open(req, timeout=300):
        pass
print(f"uploaded {len(req_files)} files")

# 4. upload function
if fn_sha in req_fns:
    req = urllib.request.Request(
        f"{API}/deploys/{did}/functions/tinyquest?runtime=js", method="PUT",
        data=open(FN_ZIP, "rb").read(),
        headers={"Content-Type": "application/octet-stream"})
    add_surrogate_to_request(req, "custom.netlify", allowed_hosts=["api.netlify.com"])
    with urllib.request.build_opener(NoRedirect()).open(req, timeout=300) as resp:
        print("function upload:", resp.status)

# 5. wait for ready
for _ in range(20):
    time.sleep(10)
    d = api("GET", f"/sites/{SITE}/deploys/{did}")
    if d["state"] == "ready":
        print("deploy ready:", did)
        break
    print("state:", d["state"])
print("DONE", did)
