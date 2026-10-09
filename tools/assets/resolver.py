"""Locate immutable asset sources by content, with paths used only as hints."""

import contextlib
import hashlib
import json
import os
import pathlib
import re
import stat
import sys
import tempfile

PROJECT = pathlib.Path(__file__).resolve().parents[2]
SKIP_NAMES = {
    ".git",
    "node_modules",
    "dist",
    "dist-dev",
    "dist-electron",
    "dist-electron-dev",
    "release",
    "release-dev",
    "__pycache__",
    ".DS_Store",
    ".Trash",
    ".Trashes",
    ".Spotlight-V100",
    ".fseventsd",
}


def cache_root():
    if os.environ.get("LANTERN_CACHE_ROOT"):
        return pathlib.Path(os.environ["LANTERN_CACHE_ROOT"]).absolute()
    home = pathlib.Path.home()
    if sys.platform == "darwin":
        base = home / "Library/Caches"
    elif sys.platform == "win32":
        base = pathlib.Path(os.environ.get("LOCALAPPDATA", home / "AppData/Local"))
    else:
        base = pathlib.Path(os.environ.get("XDG_CACHE_HOME", home / ".cache"))
    return base / "LanternKnight"


def safe_relative(name):
    if (
        not name
        or "\\" in name
        or ":" in name
        or any(p in ("", ".", "..") for p in name.split("/"))
    ):
        raise ValueError("unsafe source member: " + name)
    return name


def signature(info):
    return (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns)


def regular_file(path):
    # Reject links in every component, including a linked source directory.
    for part in [path, *path.parents]:
        if part.is_symlink():
            return False
    return stat.S_ISREG(path.stat().st_mode)


def load_index(path):
    """Bounded authored supplements; identities may never override one another."""
    path = pathlib.Path(path)
    index = json.loads(path.read_text())
    for name in index.get("includes", []):
        safe_relative(name)
        supplement = json.loads((path.parent / name).read_text())
        for section in ("archives", "archiveGroups", "prefixes", "directories", "files"):
            target = index.setdefault(section, {})
            for key, value in supplement.get(section, {}).items():
                if key in target and target[key] != value:
                    raise ValueError("conflicting source identity: " + section + "/" + key)
                target[key] = value
    return index


class SourceResolver:
    def __init__(
        self,
        root,
        index,
        *,
        library_root=None,
        documents_root=None,
        cache=None,
        excluded=(),
        search_roots=None,
    ):
        self.root = pathlib.Path(root).absolute()
        self.index = index
        suffix = pathlib.PurePosixPath(
            index.get("libraryDirectory", "2d Assets/Lantern Knight")
        ).parts
        inferred = self.root
        if self.root.parts[-len(suffix) :] == suffix:
            for _ in suffix:
                inferred = inferred.parent
        self.library = pathlib.Path(
            library_root or os.environ.get("ASSET_LIBRARY_ROOT") or inferred
        ).absolute()
        self.documents = pathlib.Path(
            documents_root or pathlib.Path.home() / "Documents"
        ).absolute()
        extra = [
            pathlib.Path(p).absolute()
            for p in os.environ.get("LANTERN_SOURCE_SEARCH_ROOTS", "").split(os.pathsep)
            if p
        ]
        self.roots = (
            list(dict.fromkeys(pathlib.Path(p).absolute() for p in search_roots))
            if search_roots is not None
            else list(dict.fromkeys([self.library, self.documents, *extra]))
        )
        self.restricted = search_roots is not None
        self.cache = pathlib.Path(cache or cache_root()).absolute()
        self.excluded = {PROJECT, self.cache, *(pathlib.Path(p).absolute() for p in excluded)}
        self.identities = {}
        for name, info in index.get("archives", {}).items():
            self.identities["archive:" + name] = (
                self.root / safe_relative(info.get("pathHint", name)),
                info,
            )
        for group, files in index.get("files", {}).items():
            for name, info in files.items():
                safe_relative(name)
                if group == "ink-collection-01":
                    if not name.startswith("collection/"):
                        raise ValueError("only collection sidecars may be loose collection sources")
                    hint = self.root / name.removeprefix("collection/")
                else:
                    hint = self.root / safe_relative(index["directories"][group]) / name
                self.identities["file:" + group + "/" + name] = (
                    self.root / safe_relative(info["pathHint"]) if "pathHint" in info else hint,
                    info,
                )
        for _, info in self.identities.values():
            if (
                not re.fullmatch("[a-f0-9]{64}", info["sha256"])
                or not isinstance(info["bytes"], int)
                or info["bytes"] < 0
            ):
                raise ValueError("invalid source identity")
        self.by_size = {}
        for _, info in self.identities.values():
            self.by_size.setdefault(info["bytes"], set()).add(info["sha256"])
        self.verified = {}
        self.scanned = set()
        self.locations = {}
        self.stats = {"scans": 0, "hashes": 0}

    @contextlib.contextmanager
    def locked(self):
        self.cache.mkdir(parents=True, exist_ok=True)
        # OS advisory locks release automatically after interruption or process exit.
        with (self.cache / "source-locations.lock").open("a+b") as lock:
            if sys.platform == "win32":
                import msvcrt

                lock.seek(0)
                if not lock.read(1):
                    lock.write(b"0")
                    lock.flush()
                lock.seek(0)
                msvcrt.locking(lock.fileno(), msvcrt.LK_LOCK, 1)
            else:
                import fcntl

                fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
            try:
                try:
                    data = json.loads((self.cache / "source-locations.json").read_text())
                    self.locations = (
                        data["locations"]
                        if data.get("schemaVersion") == 1
                        and isinstance(data.get("locations"), dict)
                        else {}
                    )
                except (OSError, ValueError, KeyError):
                    self.locations = {}
                yield
            finally:
                if sys.platform == "win32":
                    lock.seek(0)
                    msvcrt.locking(lock.fileno(), msvcrt.LK_UNLCK, 1)
                else:
                    fcntl.flock(lock.fileno(), fcntl.LOCK_UN)

    def save(self):
        fd, temporary = tempfile.mkstemp(prefix=".source-locations-", dir=self.cache)
        try:
            with os.fdopen(fd, "w") as out:
                json.dump({"schemaVersion": 1, "locations": self.locations}, out, sort_keys=True)
                out.flush()
                os.fsync(out.fileno())
            os.replace(temporary, self.cache / "source-locations.json")
        finally:
            pathlib.Path(temporary).unlink(missing_ok=True)

    def digest(self, path):
        try:
            if not regular_file(path):
                return None
            with path.open("rb") as stream:
                before = signature(os.fstat(stream.fileno()))
                if before[2] not in self.by_size:
                    return None
                cached = self.verified.get(str(path))
                if cached and cached[0] == before:
                    return cached[1]
                self.stats["hashes"] += 1
                digest = (
                    hashlib.file_digest(stream, "sha256").hexdigest()
                    if hasattr(hashlib, "file_digest")
                    else self.hash_stream(stream)
                )
                if before != signature(os.fstat(stream.fileno())) or before != signature(
                    path.stat()
                ):
                    return None
                self.verified[str(path)] = (before, digest)
                return digest
        except OSError:
            return None

    @staticmethod
    def hash_stream(stream):
        digest = hashlib.sha256()
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
        return digest.hexdigest()

    def matches(self, path, info):
        try:
            if self.restricted and not any(
                path.absolute().is_relative_to(root) for root in self.roots
            ):
                return False
            return path.stat().st_size == info["bytes"] and self.digest(path) == info["sha256"]
        except OSError:
            return False

    def scan(self, root):
        if root in self.scanned:
            return
        self.scanned.add(root)
        self.stats["scans"] += 1
        if any(root.is_relative_to(p) for p in self.excluded) or any(
            p.is_symlink() for p in [root, *root.parents]
        ):
            return
        # Index all registered identities in a single pass so subsequent reader
        # subprocesses use warm locations instead of walking Documents again.
        for directory, dirs, files in os.walk(root, followlinks=False):
            base = pathlib.Path(directory)
            dirs[:] = sorted(
                d
                for d in dirs
                if d not in SKIP_NAMES
                and not d.startswith(".")
                and base / d not in self.excluded
                and not (base / d).is_symlink()
            )
            for name in sorted(files):
                if name.startswith(".") or name in SKIP_NAMES:
                    continue
                path = base / name
                digest = self.digest(path)
                if digest is None:
                    continue
                try:
                    expected = self.by_size.get(path.stat().st_size, ())
                    if digest in expected:
                        previous = self.locations.get(digest)
                        # Keep library precedence and choose the first sorted match.
                        if not isinstance(previous, str) or not self.matches(
                            pathlib.Path(previous), {"sha256": digest, "bytes": path.stat().st_size}
                        ):
                            self.locations[digest] = str(path)
                except OSError:
                    continue

    def resolve(self, key):
        if key not in self.identities:
            raise ValueError("unregistered source: " + key)
        hint, info = self.identities[key]
        with self.locked():
            if self.matches(hint, info):
                if self.locations.get(info["sha256"]) != str(hint):
                    self.locations[info["sha256"]] = str(hint)
                    self.save()
                return hint
            cached = self.locations.get(info["sha256"])
            if isinstance(cached, str) and self.matches(pathlib.Path(cached), info):
                return pathlib.Path(cached)
            if isinstance(cached, str):
                self.scanned.clear()
            self.locations.pop(info["sha256"], None)
            for root in self.roots:
                self.scan(root)
                cached = self.locations.get(info["sha256"])
                if isinstance(cached, str) and self.matches(pathlib.Path(cached), info):
                    self.save()
                    return pathlib.Path(cached)
            self.save()
            # A later request can retry after a move has finished.
            self.scanned.clear()
        searched = ", ".join(str(root) for root in self.roots)
        raise FileNotFoundError(
            f"Missing exact asset source {key} (SHA-256 {info['sha256']}); searched {searched}"
        )

    @contextlib.contextmanager
    def open(self, key):
        # Retry once if a source is moved/replaced between discovery and opening.
        for attempt in range(2):
            path = self.resolve(key)
            info = self.identities[key][1]
            stream = None
            try:
                if not regular_file(path):
                    raise FileNotFoundError(path)
                stream = path.open("rb")
                before = signature(os.fstat(stream.fileno()))
                cached = self.verified.get(str(path))
                if not cached or cached[0] != before or cached[1] != info["sha256"]:
                    digest = self.hash_stream(stream)
                    if (
                        digest != info["sha256"]
                        or before[2] != info["bytes"]
                        or before != signature(os.fstat(stream.fileno()))
                    ):
                        raise FileNotFoundError("source changed during recovery")
                stream.seek(0)
            except OSError as error:
                if stream:
                    stream.close()
                self.verified.pop(str(path), None)
                self.scanned.clear()
                if attempt == 1:
                    raise FileNotFoundError("source changed during recovery: " + key) from error
                continue
            try:
                yield stream
                if before != signature(os.fstat(stream.fileno())):
                    raise ValueError("source changed while reading: " + key)
            finally:
                stream.close()
            return

    def read(self, key):
        with self.open(key) as stream:
            data = stream.read()
        info = self.identities[key][1]
        if len(data) != info["bytes"] or hashlib.sha256(data).hexdigest() != info["sha256"]:
            raise ValueError("source changed while reading: " + key)
        return data
