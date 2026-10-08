"""Read selected source bytes; recover moved originals without importing them."""

import json
import base64
import pathlib
import stat
import sys
import zipfile

from resolver import SourceResolver, safe_relative


def read(root, index, group, member, resolver=None):
    safe_relative(member)
    resolver = resolver or SourceResolver(root, index)
    if group in index.get("archiveGroups", {}):
        archive = index["archiveGroups"][group]
        with resolver.open("archive:" + archive) as stream, zipfile.ZipFile(stream) as z:
            entries = [i for i in z.infolist() if i.filename == member]
            if len(entries) != 1 or stat.S_ISLNK(entries[0].external_attr >> 16):
                raise ValueError("missing or ambiguous archive source: " + group + "/" + member)
            return z.read(entries[0])
    if group != "ink-collection-01" or member.startswith("collection/"):
        return resolver.read("file:" + group + "/" + member)
    found = None
    for archive in index["prefixes"].get(member.split("/")[0], []):
        with resolver.open("archive:" + archive) as stream, zipfile.ZipFile(stream) as z:
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


def serve():
    resolvers = {}
    for line in sys.stdin:
        request = json.loads(line)
        try:
            root, index_path = request["root"], request["index"]
            key = (root, index_path)
            if key not in resolvers:
                index = json.loads(pathlib.Path(index_path).read_text())
                resolvers[key] = SourceResolver(root, index)
            resolver = resolvers[key]
            data = read(root, resolver.index, request["group"], request["member"], resolver)
            response = {"id": request["id"], "data": base64.b64encode(data).decode("ascii")}
        except (OSError, ValueError, KeyError, zipfile.BadZipFile) as error:
            response = {"id": request["id"], "error": str(error)}
        print(json.dumps(response), flush=True)


if __name__ == "__main__" and sys.argv[1:] == ["--serve"]:
    serve()
elif __name__ == "__main__":
    root, index, group, member = sys.argv[1:]
    sys.stdout.buffer.write(
        read(pathlib.Path(root), json.loads(pathlib.Path(index).read_text()), group, member)
    )
