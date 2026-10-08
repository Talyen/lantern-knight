"""Explicit source health and content-preserving library consolidation."""

import argparse
import hashlib
import json
import os
import pathlib
import tempfile
from collections import defaultdict

from resolver import PROJECT, SourceResolver, regular_file, safe_relative


def digest(path):
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def numbered(name):
    return name[:2].isdigit() and " - " in name


def check_sources(root, index, roots=None, fresh=False):
    with tempfile.TemporaryDirectory(prefix="lantern-source-check-") as temporary:
        resolver = SourceResolver(
            root, index, search_roots=roots, cache=temporary if fresh else None
        )
        failures = []
        for key in resolver.identities:
            try:
                resolver.resolve(key)
            except (OSError, ValueError) as error:
                failures.append(str(error))
        if failures:
            raise ValueError("\n".join(failures[:10]))
        return len(resolver.identities)


def inventory(root):
    records = []
    for directory, dirs, files in os.walk(root, followlinks=False):
        base = pathlib.Path(directory)
        dirs[:] = sorted(d for d in dirs if not d.startswith(".") and not (base / d).is_symlink())
        for name in sorted(files):
            p = base / name
            if name.startswith("."):
                continue
            if not regular_file(p):
                raise ValueError("library contains a link or special file: " + str(p))
            records.append(
                {
                    "path": p.relative_to(root).as_posix(),
                    "bytes": p.stat().st_size,
                    "sha256": digest(p),
                }
            )
    return records


def relocation(name):
    if name.startswith("Project Sources/"):
        group = name.split("/")[1]
        category = (
            "00 - Guides and Catalogues/Foundation Sources"
            if group == "foundation-proxy"
            else (
                "01 - Hero Animations/90 - Original View Studies - Earlier Tests/Project Sources"
                if group.startswith("rust_")
                else "03 - Environments and Locations/Project Sources"
            )
        )
        return category + "/" + name.removeprefix("Project Sources/")
    if name.startswith("Animations/"):
        return (
            "01 - Hero Animations/90 - Original View Studies - Earlier Tests/Project Sources/"
            + name.removeprefix("Animations/")
        )
    return name


def make_plan(root):
    records = inventory(root)
    groups = defaultdict(list)
    for record in records:
        groups[(record["sha256"], record["bytes"])].append(record)
    keep, remove, moves = [], [], []
    for copies in groups.values():
        # Numbered collections win; keep rejected aliases in their rejected area.
        # Preserve original 16-drawing registrations for shared walk drawings.
        ordered = sorted(
            copies,
            key=lambda r: (
                not numbered(r["path"].split("/")[0]),
                "rejected-boiled/" not in r["path"],
                "rust_16_frame_drawing_walk_prototype/" not in r["path"],
                r["path"].startswith("Animations/"),
                r["path"],
            ),
        )
        survivor = ordered[0]
        target = relocation(survivor["path"])
        keep.append({**survivor, "path": target})
        if target != survivor["path"]:
            moves.append({**survivor, "destination": target})
        for redundant in ordered[1:]:
            remove.append({**redundant, "retained": target})
    targets = [r["path"] for r in keep]
    if len(set(p.casefold() for p in targets)) != len(targets):
        raise ValueError("relocation creates colliding retained paths")
    return {
        "schemaVersion": 1,
        "root": str(root),
        "inventory": records,
        "keep": keep,
        "moves": moves,
        "remove": remove,
    }


def apply_plan(root, index, plan):
    if plan.get("schemaVersion") != 1 or pathlib.Path(plan["root"]) != root:
        raise ValueError("manifest belongs to another library")
    # Rebuild the deterministic plan, validating its complete inventory and actions.
    if make_plan(root) != plan:
        raise ValueError("library or manifest changed; regenerate the plan before applying")
    # Every registered identity must have a planned survivor before any mutation.
    identities = {
        (r["sha256"], r["bytes"]) for r in plan["keep"] if numbered(r["path"].split("/")[0])
    }
    resolver = SourceResolver(root, index)
    if any((i["sha256"], i["bytes"]) not in identities for _, i in resolver.identities.values()):
        raise ValueError(
            "numbered-folder survivors omit a registered identity; no library changes made"
        )
    for record in plan["moves"]:
        destination = root / safe_relative(record["destination"])
        if destination.exists():
            raise ValueError("relocation destination already exists: " + str(destination))
        destination.parent.mkdir(parents=True, exist_ok=True)
        (root / safe_relative(record["path"])).rename(destination)
    numbered_roots = [p for p in root.iterdir() if p.is_dir() and numbered(p.name)]
    # Prove retained copies alone cover the registry, including legacy loose files.
    check_sources(root, index, numbered_roots, fresh=True)
    for record in plan["remove"]:
        redundant, retained = (
            root / safe_relative(record["path"]),
            root / safe_relative(record["retained"]),
        )
        for p in (retained, redundant):
            if (
                not regular_file(p)
                or p.stat().st_size != record["bytes"]
                or digest(p) != record["sha256"]
            ):
                raise ValueError("duplicate changed; stopped before deleting: " + str(p))
        redundant.unlink()
    check_sources(root, index, numbered_roots, fresh=True)
    for directory, _, _ in os.walk(root, topdown=False):
        p = pathlib.Path(directory)
        if p == root:
            continue
        # Finder metadata does not keep an obsolete source directory alive.
        if list(p.iterdir()) == [p / ".DS_Store"]:
            (p / ".DS_Store").unlink()
        if not list(p.iterdir()):
            p.rmdir()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("mode", choices=["check", "dedupe"])
    ap.add_argument("--root", type=pathlib.Path)
    ap.add_argument("--index", type=pathlib.Path, default=PROJECT / "assets/sources.json")
    ap.add_argument("--numbered-only", action="store_true")
    ap.add_argument("--fresh", action="store_true")
    ap.add_argument("--manifest", type=pathlib.Path)
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()
    index = json.loads(args.index.read_text())
    library = pathlib.Path(
        os.environ.get("ASSET_LIBRARY_ROOT", pathlib.Path.home() / "Documents/Asset Library")
    )
    root = (args.root or library / index["libraryDirectory"]).absolute()
    if args.mode == "check":
        if args.apply or args.manifest:
            ap.error("--apply/--manifest belong to dedupe")
        roots = (
            [p for p in root.iterdir() if p.is_dir() and numbered(p.name)]
            if args.numbered_only
            else None
        )
        count = check_sources(root, index, roots, args.fresh)
        print(
            f"PASS: {count} source identities verified"
            + (" in numbered folders only." if roots is not None else ".")
        )
    elif args.apply:
        if not args.manifest:
            ap.error("--apply requires --manifest from a dry run")
        plan = json.loads(args.manifest.read_text())
        apply_plan(root, index, plan)
        print(
            f"Consolidated {len(plan['moves'])} sources; deleted {len(plan['remove'])} exact redundant copies ({sum(r['bytes'] for r in plan['remove']) / 1024**3:.2f} GiB)."
        )
    else:
        plan = make_plan(root)
        manifest = args.manifest
        if manifest is None:
            fd, name = tempfile.mkstemp(prefix="lantern-library-dedupe-", suffix=".json")
            os.close(fd)
            manifest = pathlib.Path(name)
        if manifest.absolute().is_relative_to(PROJECT) or manifest.absolute().is_relative_to(root):
            raise ValueError("manifest must stay outside the checkout and source library")
        manifest.write_text(json.dumps(plan, indent=2) + "\n")
        print(
            f"Dry run: {len(plan['moves'])} relocations, {len(plan['remove'])} redundant copies; manifest: {manifest}"
        )


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, KeyError) as error:
        raise SystemExit(str(error))
