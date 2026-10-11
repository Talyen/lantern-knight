"""Reconcile the current external library by content, without editorial eligibility rules."""

import argparse
import hashlib
import io
import json
import os
import pathlib
import stat
import zipfile
from PIL import Image, ImageOps
from resolver import load_index, safe_relative

IMAGE_TYPES = {".png", ".jpg", ".jpeg", ".webp"}
MEDIA_TYPES = {
    ".gif",
    ".apng",
    ".mp4",
    ".webm",
    ".wav",
    ".mp3",
    ".ogg",
    ".pdf",
    ".glb",
    ".blend",
    ".svg",
    ".ttf",
}


def sha(data):
    return hashlib.sha256(data).hexdigest()


def file_hash(p):
    h = hashlib.sha256()
    with p.open("rb") as f:
        for b in iter(lambda: f.read(1024 * 1024), b""):
            h.update(b)
    return h.hexdigest()


def image_info(data):
    with Image.open(io.BytesIO(data)) as original:
        image = ImageOps.exif_transpose(original)
        return {
            "canvas": list(image.size),
            "animated": getattr(original, "n_frames", 1) > 1,
            "alpha": image.convert("RGBA").getextrema()[3][0] < 255,
        }


def discover(root, original, previous=None, identities=None):
    previous = previous if previous and previous.get("discoveryVersion") in (4, 5, 6, 7, 8) else {}
    metadata_current = previous.get("discoveryVersion") == 8
    prior = {r["path"]: r for r in previous.get("files", [])}
    records, images, media, problems = [], {}, {}, []
    archives = {}
    identities = identities or {}
    old_images = [*identities.get('images', []), *previous.get('images', [])]
    image_by_hash = {i['sha256']: i for i in old_images}
    image_by_path = {i['path']: i for i in old_images}
    old_archives = [*identities.get('archives', []), *[r for r in previous.get('files', []) if r['kind'] == 'archive']]
    archive_by_path = {r['path']: r for r in old_archives}
    archive_by_hash = {r['sha256']: r for r in old_archives}
    for directory, dirs, files in os.walk(root, followlinks=False):
        parent = pathlib.Path(directory)
        dirs[:] = sorted(d for d in dirs if not d.startswith(".") and not (parent / d).is_symlink())
        for name in sorted(files):
            if name.startswith("."):
                continue
            p = parent / name
            info = p.lstat()
            if not stat.S_ISREG(info.st_mode):
                problems.append(
                    {"path": p.relative_to(root).as_posix(), "reason": "not a regular file"}
                )
                continue
            rel = p.relative_to(root).as_posix()
            stamp = [info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns]
            old = prior.get(rel)
            digest = old["sha256"] if old and old.get("signature") == stamp else file_hash(p)
            record = {
                "path": rel,
                "sha256": digest,
                "bytes": info.st_size,
                "signature": stamp,
                "kind": "source",
                "assets": [],
            }
            suffix = p.suffix.lower()
            ref = {"group": "library-discovered", "member": digest + suffix, "sha256": digest}
            if suffix in IMAGE_TYPES | MEDIA_TYPES:
                if suffix in IMAGE_TYPES:
                    try:
                        details = (
                            old.get("image") if metadata_current and old and old.get("signature") == stamp else None
                        )
                        details = details or image_info(p.read_bytes())
                        record["image"] = details
                        record["kind"] = "media" if details["animated"] else "image"
                        (media if details["animated"] else images).setdefault(
                            digest, {**ref, **details, "path": rel}
                        )
                    except (OSError, ValueError) as e:
                        problems.append({"path": rel, "reason": str(e)})
                else:
                    record["kind"] = "media"
                    media.setdefault(digest, {**ref, "path": rel})
            if suffix == ".zip":
                record["kind"] = "archive"
                old_archive = archive_by_hash.get(digest) or archive_by_path.get(rel)
                record['assetIdentity'] = old_archive.get('assetIdentity', old_archive['sha256']) if old_archive else digest
                archives.setdefault(digest, rel)
                members = old.get("members") if metadata_current and old and old["sha256"] == digest else None
                if members is None:
                    members = []
                    old_members = {m['sha256']: m for m in (old_archive or {}).get('members', [])} if metadata_current else {}
                    try:
                        with zipfile.ZipFile(p) as z:
                            names = set()
                            for member in z.infolist():
                                if member.is_dir():
                                    continue
                                safe_relative(member.filename)
                                if member.filename in names or stat.S_ISLNK(
                                    member.external_attr >> 16
                                ):
                                    raise ValueError(
                                        "duplicate or symlink archive member: " + member.filename
                                    )
                                names.add(member.filename)
                                ext = pathlib.PurePosixPath(member.filename).suffix.lower()
                                data = z.read(member)
                                m = {
                                    "member": member.filename,
                                    "sha256": sha(data),
                                    "bytes": len(data),
                                    "suffix": ext,
                                }
                                if ext in IMAGE_TYPES:
                                    prior_member = old_members.get(m['sha256'])
                                    m.update({k: prior_member[k] for k in ('canvas', 'animated', 'alpha')}
                                        if prior_member and 'canvas' in prior_member else image_info(data))
                                members.append(m)
                    except (OSError, ValueError, zipfile.BadZipFile) as e:
                        problems.append({"path": rel, "reason": str(e)})
                record["members"] = members or []
                for m in record["members"]:
                    if m["suffix"] not in IMAGE_TYPES | MEDIA_TYPES:
                        continue
                    target = media if m["suffix"] in MEDIA_TYPES or m.get("animated") else images
                    target.setdefault(
                        m["sha256"],
                        {
                            **{k: v for k, v in m.items() if k not in ("suffix", "bytes")},
                            "group": "discovered-" + digest[:24],
                            "path": rel + " / " + m["member"],
                        },
                    )
            records.append(record)
    # Identity follows moves by content and replacements by their existing path.
    # Distinct retained versions still receive separate logical bindings.
    for image in images.values():
        old_image = image_by_hash.get(image['sha256']) or image_by_path.get(image['path'])
        image['assetIdentity'] = old_image.get('assetIdentity', old_image['sha256']) if old_image else image['sha256']
    # Copies share an identity, but retained revisions must not overwrite their
    # replacement's scene binding or animation timeline.
    for current, prior_by_path in (
        (list(images.values()), image_by_path),
        ([r for r in records if r['kind'] == 'archive'], archive_by_path),
    ):
        owners = {}
        for record in current:
            owners.setdefault(record['assetIdentity'], {}).setdefault(record['sha256'], []).append(record)
        for identity, versions in owners.items():
            if len(versions) < 2:
                continue
            owner = next((digest for digest, copies in versions.items() if any(
                r['path'] in prior_by_path and prior_by_path[r['path']]['sha256'] != digest
                for r in copies
            )), next(iter(versions)))
            for digest, copies in versions.items():
                if digest != owner:
                    retained = sha(('retained-version:' + identity + ':' + digest).encode())
                    for record in copies:
                        record['assetIdentity'] = retained
    by_hash = {}
    archived = {}
    for r in records:
        by_hash.setdefault(r["sha256"], r["path"])
        for m in r.get("members", []):
            archived.setdefault(
                m["sha256"],
                {"archive": "discovered/" + r["sha256"] + ".zip", "member": m["member"]},
            )
    index = json.loads(json.dumps(original))
    index.pop("includes", None)
    missing = []
    by_path = {r['path']: r for r in records}
    image_owners = {i['assetIdentity']: i for i in images.values()}
    archive_owners = {r['assetIdentity']: r for r in records if r['kind'] == 'archive'}
    source_bytes = {r['sha256']: r['bytes'] for r in records}
    source_bytes.update({m['sha256']: m['bytes'] for r in records for m in r.get('members', [])})
    for name, identity in list(index.get("archives", {}).items()):
        current = by_path.get(identity.get('pathHint')) or archive_owners.get(identity['sha256'])
        if current and current['kind'] == 'archive':
            identity.update(sha256=current['sha256'], bytes=current['bytes'], pathHint=current['path'])
        elif identity["sha256"] in archives:
            identity["pathHint"] = archives[identity["sha256"]]
        else:
            missing.append({"logical": "archive:" + name, **identity})
            del index["archives"][name]
    for group, files in index.get("files", {}).items():
        for member, identity in list(files.items()):
            current = by_path.get(identity.get('pathHint'))
            lineage = image_owners.get(identity['sha256'])
            if current and current['kind'] != 'archive':
                identity.update(sha256=current['sha256'], bytes=current['bytes'])
                identity.pop('archive', None)
                identity.pop('member', None)
            elif lineage and lineage['sha256'] in by_hash:
                identity.update(sha256=lineage['sha256'], bytes=source_bytes[lineage['sha256']], pathHint=by_hash[lineage['sha256']])
                identity.pop('archive', None)
                identity.pop('member', None)
            elif lineage and lineage['sha256'] in archived:
                identity.update(archived[lineage['sha256']], sha256=lineage['sha256'], bytes=source_bytes[lineage['sha256']])
            elif identity["sha256"] in by_hash:
                identity["pathHint"] = by_hash[identity["sha256"]]
                identity.pop("archive", None)
                identity.pop("member", None)
            elif identity["sha256"] in archived:
                identity.update(archived[identity["sha256"]])
            else:
                missing.append({"logical": "file:" + group + "/" + member, **identity})
                del files[member]
    index.setdefault("files", {})["library-discovered"] = {
        r["sha256"] + pathlib.PurePosixPath(r["path"]).suffix.lower(): {
            "sha256": r["sha256"],
            "bytes": r["bytes"],
            "pathHint": r["path"],
        }
        for r in records
    }
    index["prefixes"] = {
        k: [a for a in names if a in index["archives"]]
        for k, names in index.get("prefixes", {}).items()
    }
    for digest, rel in archives.items():
        key = "discovered/" + digest + ".zip"
        r = next(r for r in records if r["path"] == rel)
        index["archives"][key] = {"sha256": digest, "bytes": r["bytes"], "pathHint": rel}
        index['archives'][key]['assetIdentity'] = r['assetIdentity']
        index.setdefault("archiveGroups", {})["discovered-" + digest[:24]] = key
    content = [{k: v for k, v in r.items() if k != "signature"} for r in records]
    identity = sha(
        json.dumps(
            {
                "version": 8,
                "files": content,
                "images": list(images.values()),
                "media": list(media.values()),
            },
            sort_keys=True,
            separators=(",", ":"),
        ).encode()
    )
    inventory = {
        "schemaVersion": 1,
        "discoveryVersion": 8,
        "sha256": identity,
        "files": records,
        "images": list(images.values()),
        "media": list(media.values()),
        "missingRegisteredSources": missing,
        "problems": problems,
    }
    return index, inventory


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", required=True, type=pathlib.Path)
    ap.add_argument("--index", required=True, type=pathlib.Path)
    ap.add_argument("--output-index", required=True, type=pathlib.Path)
    ap.add_argument("--output-inventory", required=True, type=pathlib.Path)
    ap.add_argument("--extra-index", type=pathlib.Path)
    args = ap.parse_args()
    identity_file = args.root / '.lantern' / 'identities.json'
    try:
        identities = json.loads(identity_file.read_text())
        if identities.get('schemaVersion') != 1:
            raise ValueError('Unsupported asset identity registry')
    except FileNotFoundError:
        identities = None
    try:
        prior = json.loads(args.output_inventory.read_text())
    except FileNotFoundError:
        prior = None
    original = load_index(args.index)
    if args.extra_index:
        extra = load_index(args.extra_index)
        for group, files in extra.get("files", {}).items():
            for identity in files.values():
                hint = identity.get("pathHint", "")
                prefix = original["libraryDirectory"] + "/"
                if hint.startswith(prefix):
                    identity["pathHint"] = hint[len(prefix) :]
            original.setdefault("files", {})[group] = files
    index, inventory = discover(args.root, original, prior, identities)
    if not inventory['problems']:
        identity_file.parent.mkdir(parents=True, exist_ok=True)
        retained = identities or {'images': [], 'archives': []}
        def retained_records(kind, current):
            values = {r['path'] + ':' + r['sha256']: r for r in retained.get(kind, [])}
            for r in current:
                values[r['path'] + ':' + r['sha256']] = {k: r[k] for k in ('path', 'sha256', 'assetIdentity')}
            return list(values.values())
        registry = {'schemaVersion': 1,
            'images': retained_records('images', inventory['images']),
            'archives': retained_records('archives', [r for r in inventory['files'] if r['kind'] == 'archive'])}
        temporary = identity_file.with_suffix('.tmp')
        temporary.write_text(json.dumps(registry, separators=(',', ':')) + '\n')
        temporary.replace(identity_file)
    for p, data in [(args.output_index, index), (args.output_inventory, inventory)]:
        p.parent.mkdir(parents=True, exist_ok=True)
        temporary = p.with_suffix(".tmp")
        temporary.write_text(json.dumps(data, separators=(",", ":")) + "\n")
        temporary.replace(p)
    print(
        f"Reconciled {len(inventory['files'])} external files, {len(inventory['images'])} distinct images, "
        f"{len(inventory['media'])} media files; {len(inventory['problems'])} unreadable entries."
    )
    if inventory["problems"]:
        raise SystemExit("Source discovery found unreadable entries; see the inventory problems.")
