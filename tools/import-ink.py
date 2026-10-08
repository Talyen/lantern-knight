#!/usr/bin/env python3
"""Import the frozen Ink collection safely; originals and existing different files are never overwritten."""

import argparse, collections, contextlib, hashlib, json, pathlib, stat, struct, zipfile
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent / "assets"))
from resolver import SourceResolver

ROOT = pathlib.Path(__file__).resolve().parents[1]
DEST = ROOT / "references/art/ink-collection-01"


def sha(data):
    return hashlib.sha256(data).hexdigest()


def role(name):
    n = name.lower()
    if any(s in n for s in ["technical_reference/", "original_provenance/", "original_manifest"]):
        return "historical-source"
    if any(
        s in n
        for s in [
            "/proof",
            "/preview",
            "/review",
            "/renders/",
            "/qa/",
            "contact_",
            "game_size",
            "qa_report",
        ]
    ) or pathlib.Path(n).suffix in [".mp4", ".gif", ".jpg"]:
        return "review-media"
    if any(s in n for s in ["mask", "/layers/"]):
        return "mask-or-layer"
    if any(s in n for s in ["/frames/", "/frames_", "/animation/"]):
        return "animation"
    if any(s in n for s in ["/materials/", "/decals/", "/transitions/"]):
        return "material-or-decal"
    if any(s in n for s in ["/source/", "/masters/", "/vectors/", "/reference/"]) or pathlib.Path(
        n
    ).suffix in [".blend", ".py", ".svg", ".ttf"]:
        return "editable-source"
    if pathlib.Path(n).suffix == ".png":
        return "artwork-or-state"
    return "metadata"


def collect(downloads, resolver=None):
    def sidecar(name):
        return (
            resolver.read("file:ink-collection-01/collection/" + name)
            if resolver
            else (downloads / name).read_bytes()
        )

    def archive_path(name):
        return resolver.resolve("archive:" + name) if resolver else downloads / name

    index_bytes = sidecar("Lantern_Revision02_Asset_Index.json")
    index = json.loads(index_bytes)
    if not index.get("frozen"):
        raise ValueError("collection index is not frozen")
    entries = {}
    folded = {}
    archives = []

    def add(name, data, archive):
        p = pathlib.PurePosixPath(name)
        if (
            not name
            or p.is_absolute()
            or any(x in ["", ".", ".."] for x in name.split("/"))
            or "\\" in name
            or ":" in name
        ):
            raise ValueError(f"unsafe source path: {name}")
        previous = folded.setdefault(name.casefold(), name)
        if previous != name:
            raise ValueError(f"case collision: {name}")
        h = sha(data)
        if name in entries and entries[name]["sha256"] != h:
            raise ValueError(f"conflicting archive members: {name}")
        image = None
        if name.lower().endswith(".png"):
            if data[:8] != b"\x89PNG\r\n\x1a\n" or data[12:16] != b"IHDR":
                raise ValueError(f"invalid PNG header: {name}")
            width, height, depth, color = struct.unpack(">IIBB", data[16:26])
            image = {
                "width": width,
                "height": height,
                "bitDepth": depth,
                "colorType": color,
                "alphaChannel": color in [4, 6],
            }
        e = entries.setdefault(
            name,
            {"path": name, "sha256": h, "bytes": len(data), "archives": [], "role": role(name)},
        )
        if image is not None:
            e["image"] = image
        if archive not in e["archives"]:
            e["archives"].append(archive)

    for archive in index["archives"]:
        p = archive_path(archive["file_name"])
        if resolver:
            identity = resolver.identities["archive:" + archive["file_name"]][1]
            if identity["bytes"] != archive["bytes"] or identity["sha256"] != archive["sha256"]:
                raise ValueError(f"archive identity differs: {archive['file_name']}")
        elif p.stat().st_size != archive["bytes"] or sha(p.read_bytes()) != archive["sha256"]:
            raise ValueError(f"archive differs: {p.name}")
        archives.append({k: archive[k] for k in ["file_name", "bytes", "sha256"]})
    quality_name = "Lantern_Revision02_Quality_Notes.zip"
    if resolver:
        resolver.resolve("archive:" + quality_name)
        archives.append(
            {"file_name": quality_name, **resolver.identities["archive:" + quality_name][1]}
        )
    else:
        quality = archive_path(quality_name)
        archives.append(
            {
                "file_name": quality_name,
                "bytes": quality.stat().st_size,
                "sha256": sha(quality.read_bytes()),
            }
        )
    for archive in archives:
        source = (
            resolver.open("archive:" + archive["file_name"])
            if resolver
            else contextlib.nullcontext(archive_path(archive["file_name"]))
        )
        with source as stream, zipfile.ZipFile(stream) as z:
            for info in z.infolist():
                if info.is_dir():
                    continue
                if stat.S_ISLNK(info.external_attr >> 16):
                    raise ValueError("archive symlinks forbidden")
                add(info.filename, z.read(info), archive["file_name"])
    if resolver:
        for name in sorted(resolver.index["files"]["ink-collection-01"]):
            add(name, resolver.read("file:ink-collection-01/" + name), "collection-sidecar")
    else:
        for p in sorted(downloads.iterdir()):
            if p.is_file() and p.suffix != ".zip" and p.name != ".DS_Store":
                add("collection/" + p.name, p.read_bytes(), "collection-sidecar")
    for name in entries:
        if any(str(p) in entries for p in pathlib.PurePosixPath(name).parents):
            raise ValueError("file/directory path conflict")
        target = DEST / name
        if any(p.is_symlink() for p in [target, *target.parents]):
            raise ValueError(f"symlink destination: {target}")
        if target.exists() and (
            not target.is_file() or sha(target.read_bytes()) != entries[name]["sha256"]
        ):
            raise ValueError(f"existing file differs: {target}")
    canonical = ROOT / "references/canon/image(3).png"
    if (
        canonical.exists()
        and sha(canonical.read_bytes())
        != "74ba2c2004e5b30da8c35f192fd725957a2a24f8b26de0ad58163608cb7dd09c"
    ):
        raise ValueError("existing canonical differs; no files written")
    return index, archives, entries


def main():
    ap = argparse.ArgumentParser(
        description="Verify external collection originals without importing generated data into Git"
    )
    ap.add_argument("downloads", nargs="?", type=pathlib.Path)
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()
    sources = json.loads((ROOT / "assets/sources.json").read_text())
    import os

    library = pathlib.Path(
        os.environ.get("ASSET_LIBRARY_ROOT", pathlib.Path.home() / "Documents/Asset Library")
    )
    downloads = args.downloads or library / sources["libraryDirectory"]
    resolver = SourceResolver(downloads, sources, library_root=library)
    _, _, entries = collect(downloads, resolver)
    print(f"PASS: {len(entries)} external originals verified; no project files written")


if __name__ == "__main__":
    main()
