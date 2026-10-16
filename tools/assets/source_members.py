"""Read original archive members from exact local copies and retained metadata."""

import hashlib
import io
import os
import pathlib
import stat
import tempfile
import zipfile

from resolver import regular_file, require_local, safe_relative, signature

METADATA_TYPES = {".json", ".txt", ".md", ".csv", ".xml", ".yaml", ".yml", ".atlas"}


def verified_bytes(path, identity):
    try:
        if not regular_file(path) or path.stat().st_size != identity["bytes"]:
            return None
        require_local(path)
        before = signature(path.stat())
        data = path.read_bytes()
        if (
            before == signature(path.stat())
            and hashlib.sha256(data).hexdigest() == identity["sha256"]
        ):
            return data
    except (OSError, RuntimeError):
        return None
    return None


def metadata_file(root, identity):
    digest = identity["sha256"]
    if len(digest) != 64 or any(c not in "0123456789abcdef" for c in digest):
        raise ValueError("Invalid source member identity")
    return pathlib.Path(root) / ".lantern" / "metadata" / digest


def retain_metadata(root, identity, data):
    if pathlib.PurePosixPath(identity["member"]).suffix.lower() not in METADATA_TYPES:
        return
    if len(data) != identity["bytes"] or hashlib.sha256(data).hexdigest() != identity["sha256"]:
        raise ValueError("Source metadata differs: " + identity["member"])
    path = metadata_file(root, identity)
    if verified_bytes(path, identity) is not None:
        return
    for parent in [path, *path.parents]:
        if parent.is_symlink():
            raise ValueError("Source metadata symlinks forbidden")
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=".metadata-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as out:
            out.write(data)
        os.replace(temporary, path)
    finally:
        pathlib.Path(temporary).unlink(missing_ok=True)


class MemberArchive:
    """ZIP-shaped access to a verified member table, with lazy archive fallback."""

    def __init__(self, resolver, archive, members):
        self.resolver, self.archive = resolver, archive
        self.members = {}
        for member in members:
            name = safe_relative(member["member"])
            metadata_file(resolver.root, member)
            if name in self.members or not isinstance(member["bytes"], int) or member["bytes"] < 0:
                raise ValueError("Duplicate or invalid source member: " + name)
            self.members[name] = member

    def namelist(self):
        return list(self.members)

    def infolist(self):
        return [zipfile.ZipInfo(name) for name in self.members]

    def read(self, member):
        name = member.filename if isinstance(member, zipfile.ZipInfo) else member
        identity = self.members[safe_relative(name)]
        for candidate in self.resolver.local_members.get(identity["sha256"], []):
            data = verified_bytes(candidate, identity)
            if data is not None:
                retain_metadata(self.resolver.root, identity, data)
                return data
        if pathlib.PurePosixPath(name).suffix.lower() in METADATA_TYPES:
            data = verified_bytes(metadata_file(self.resolver.root, identity), identity)
            if data is not None:
                return data
        with (
            self.resolver.open("archive:" + self.archive) as stream,
            zipfile.ZipFile(stream) as original,
        ):
            matches = [i for i in original.infolist() if i.filename == name]
            if len(matches) != 1 or stat.S_ISLNK(matches[0].external_attr >> 16):
                raise ValueError("Missing or unsafe source member: " + name)
            data = original.read(matches[0])
        if len(data) != identity["bytes"] or hashlib.sha256(data).hexdigest() != identity["sha256"]:
            raise ValueError("Source member differs: " + name)
        retain_metadata(self.resolver.root, identity, data)
        return data

    def dimensions(self, member):
        return self.members[member].get("nativeCanvas")

    def open(self, member):
        return io.BytesIO(self.read(member))
