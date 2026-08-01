import json, sys, os
inv = json.load(open(sys.argv[1])); outdir = sys.argv[2]
os.makedirs(outdir, exist_ok=True)
summary = {}
for k, v in inv.items():
    sch = v.get("input_schema")
    slug = k.replace("~", "__")
    if not sch:
        summary[k] = {"error": "no input schema on build"}; continue
    json.dump(sch, open(f"{outdir}/{slug}.input.json", "w"), indent=2)
    fields = {}
    for name, p in (sch.get("properties") or {}).items():
        fields[name] = {
            "type": p.get("type"),
            "editor": p.get("editor"),
            "required": name in (sch.get("required") or []),
            "default": p.get("default"),
            "enum": p.get("enum"),
            "enumTitles": p.get("enumTitles"),
            "maxItems": p.get("maxItems"),
            "minItems": p.get("minItems"),
            "maximum": p.get("maximum"),
            "minimum": p.get("minimum"),
            "prefill": p.get("prefill"),
            "title": p.get("title"),
            "description": (p.get("description") or "")[:400],
        }
    summary[k] = {"required": sch.get("required") or [], "fields": fields}
json.dump(summary, open(f"{outdir}/_schema_summary.json", "w"), indent=2)
print("wrote", len(summary), "schemas")
