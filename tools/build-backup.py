"""Bundle the artifact's exported data into the one backup file the import page reads.

    python tools/build-backup.py export/raw export/fitness-backup.json

For the move to Cloudflare (CLOUDFLARE.md, "Moving the data"). Claude first reads the claude.ai
artifact's data read-only into export/raw/ (the ArtifactData tool's out_dir layout:
data/users/me/log/sessions/<id>.json, data/users/me/log/weights/<id>.json and
data/users/me/<goals|lifting|swim>.json). This script turns that into one file:

    {"format": "fitness-tracker-backup", "version": 1, "exportedAt": "...",
     "sessions": [{"id", "data"}], "weights": [...], "state": [...]}

export/ is git-ignored and nothing here is ever committed. The script prints counts and names
only, never a value. The swim in progress (live) is left out on purpose.
"""
import datetime
import json
import pathlib
import re
import sys

DOC_ID = re.compile(r"^[A-Za-z0-9_-]{1,80}$")  # the Worker's own rule for ids
SINGLE = ["goals", "lifting", "swim"]
# keys a tool may wrap a document in; anything else means the file is the document itself
WRAPPER_KEYS = {"id", "doc_id", "version", "data", "collection", "path", "created_at", "updated_at",
                "createTime", "updateTime"}


def document(path):
    obj = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(obj, dict):
        raise SystemExit(f"{path.name}: not a document (a {type(obj).__name__})")
    if "data" in obj and set(obj) <= WRAPPER_KEYS and isinstance(obj["data"], dict):
        return obj["data"], True
    return obj, False


def main(raw, out):
    base = pathlib.Path(raw) / "data" / "users" / "me"
    if not base.is_dir():
        raise SystemExit(f"no export at {base}")
    backup = {"format": "fitness-tracker-backup", "version": 1,
              "exportedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
              "sessions": [], "weights": [], "state": []}
    wrapped = set()
    for kind in ("sessions", "weights"):
        folder = base / "log" / kind
        for f in sorted(folder.glob("*.json")) if folder.is_dir() else []:
            if not DOC_ID.match(f.stem):
                raise SystemExit(f"{kind}: an id the app can't use: {f.stem}")
            data, w = document(f)
            if w:
                wrapped.add(kind)
            backup[kind].append({"id": f.stem, "data": data})
    for name in SINGLE:
        f = base / (name + ".json")
        if f.is_file():
            data, w = document(f)
            if w:
                wrapped.add(name)
            backup["state"].append({"id": name, "data": data})
    left_out = [f.name for f in base.glob("*.json") if f.stem not in SINGLE]
    pathlib.Path(out).write_text(json.dumps(backup, indent=1, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")
    print(f"wrote {out}")
    print(f"  sessions: {len(backup['sessions'])}")
    print(f"  weigh-ins: {len(backup['weights'])}")
    print(f"  documents: {', '.join(d['id'] for d in backup['state']) or 'none'}")
    if wrapped:
        print(f"  unwrapped from the tool's envelope: {', '.join(sorted(wrapped))}")
    if left_out:
        print(f"  left out on purpose: {', '.join(sorted(left_out))}")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    main(sys.argv[1], sys.argv[2])
