"""Read selected source bytes; recover moved originals without importing them."""

import json
import base64
import pathlib
import stat
import sys
import zipfile
import os
import contextlib
from collections import OrderedDict

from resolver import SourceResolver, safe_relative, load_index, signature


class ArchiveReader:
    """Reuse at most eight verified ZIP directories across selected-member reads."""

    def __init__(self):
        self.entries = OrderedDict()

    @contextlib.contextmanager
    def open(self, resolver, archive):
        key = (str(resolver.root), archive)
        # Every request still verifies the source identity and detects writes
        # before/after reading. Cached handles only avoid rereading ZIP tables.
        with resolver.open("archive:" + archive) as verified:
            stamp = signature(os.fstat(verified.fileno()))
            entry = self.entries.pop(key, None)
            if entry and entry[0] != stamp:
                entry[1].close()
                entry[2].close()
                entry = None
            if not entry:
                stream = os.fdopen(os.dup(verified.fileno()), "rb")
                try:
                    entry = (stamp, zipfile.ZipFile(stream), stream)
                except Exception:
                    stream.close()
                    raise
            self.entries[key] = entry
            while len(self.entries) > 8:
                _, old = self.entries.popitem(last=False)
                old[1].close()
                old[2].close()
            yield entry[1]

    def close(self):
        for _, archive, stream in self.entries.values():
            archive.close()
            stream.close()
        self.entries.clear()


def read(root, index, group, member, resolver=None, archive_reader=None):
    safe_relative(member)
    resolver = resolver or SourceResolver(root, index)
    if group in index.get("archiveGroups", {}):
        archive = index["archiveGroups"][group]
        with (
            archive_reader.open(resolver, archive)
            if archive_reader
            else open_archive(resolver, archive)
        ) as z:
            entries = [i for i in z.infolist() if i.filename == member]
            if len(entries) != 1 or stat.S_ISLNK(entries[0].external_attr >> 16):
                raise ValueError("missing or ambiguous archive source: " + group + "/" + member)
            return z.read(entries[0])
    if group != "ink-collection-01" or member.startswith("collection/"):
        return resolver.read("file:" + group + "/" + member)
    found = None
    for archive in index["prefixes"].get(member.split("/")[0], []):
        with (
            archive_reader.open(resolver, archive)
            if archive_reader
            else open_archive(resolver, archive)
        ) as z:
            # Duplicate ZIP entries must not silently select a different revision.
            for entry in z.infolist():
                if entry.filename != member:
                    continue
                if stat.S_ISLNK(entry.external_attr >> 16):
                    raise ValueError("source symlinks forbidden")
                data = z.read(entry)
                if found is not None and found != data:
                    raise ValueError("conflicting source members")
                found = data
    if found is None:
        raise ValueError("missing exact source member: " + member)
    return found


@contextlib.contextmanager
def open_archive(resolver, archive):
    with resolver.open("archive:" + archive) as stream, zipfile.ZipFile(stream) as z:
        yield z


def serve():
    resolvers = {}
    archives = ArchiveReader()
    for line in sys.stdin:
        request = json.loads(line)
        try:
            root, index_path = request["root"], request["index"]
            key = (root, index_path)
            if key not in resolvers:
                index = load_index(index_path)
                resolvers[key] = SourceResolver(root, index)
            resolver = resolvers[key]
            data = read(
                root, resolver.index, request["group"], request["member"], resolver, archives
            )
            response = {"id": request["id"], "data": base64.b64encode(data).decode("ascii")}
        except (OSError, ValueError, KeyError, zipfile.BadZipFile) as error:
            response = {"id": request["id"], "error": str(error)}
        print(json.dumps(response), flush=True)
    archives.close()


if __name__ == "__main__" and sys.argv[1:] == ["--serve"]:
    serve()
elif __name__ == "__main__":
    root, index, group, member = sys.argv[1:]
    sys.stdout.buffer.write(read(pathlib.Path(root), load_index(index), group, member))
