"""Filesystem recovery integration tests; all rearrangements stay in temp fixtures."""

import hashlib
import io
import json
import os
import pathlib
import subprocess
import sys
import tempfile
import unittest
import zipfile
from unittest.mock import patch

PROJECT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT / "tools/assets"))
from resolver import SourceResolver, load_index, signature  # noqa: E402 - local modules require the path above.
from source import read  # noqa: E402 - local modules require the path above.
from library import make_plan, apply_plan, check_sources  # noqa: E402 - local module path.


def identity(data):
    return {"bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}


class Recovery(unittest.TestCase):
    def test_default_reader_rejects_external_cached_sources_and_environment_roots(self):
        owned = SourceResolver(self.root, self.index, cache=self.cache)
        self.assertEqual(owned.read("file:walk/frames/one.png"), self.payload)
        moved = self.move(self.loose, self.documents / "outside.png")
        with patch.dict(os.environ, {"ASSET_LIBRARY_ROOT": str(self.library), "LANTERN_SOURCE_SEARCH_ROOTS": str(self.documents)}):
            external = self.resolver()
            self.assertEqual(external.read("file:walk/frames/one.png"), self.payload)
            confined = SourceResolver(self.root, self.index, cache=self.cache)
            with self.assertRaises(FileNotFoundError):
                confined.read("file:walk/frames/one.png")
        self.assertTrue(moved.exists())

    def test_supplements_merge_file_members_without_overriding_identities(self):
        first = {"files": {"walk": {"one.png": identity(b"one")}}}
        second = {"files": {"walk": {"two.png": identity(b"two")}}}
        (self.base / "one.json").write_text(json.dumps(first))
        (self.base / "two.json").write_text(json.dumps(second))
        self.index_path.write_text(json.dumps({"includes": ["one.json", "two.json"]}))
        self.assertEqual(set(load_index(self.index_path)["files"]["walk"]), {"one.png", "two.png"})
        second["files"]["walk"]["one.png"] = identity(b"different")
        (self.base / "two.json").write_text(json.dumps(second))
        with self.assertRaisesRegex(ValueError, "conflicting source identity"):
            load_index(self.index_path)

    def test_missing_numbered_survivor_blocks_before_any_relocation(self):
        plan = make_plan(self.root)
        with self.assertRaisesRegex(ValueError, "no library changes"):
            apply_plan(self.root, self.index, plan)
        self.assertTrue(self.loose.exists())
        self.assertTrue((self.root / "pack.zip").exists())

    def test_location_hints_aliases_and_restricted_check_reject_legacy_fallback(self):
        numbered = self.root / "01 - Hero Animations"
        copied = numbered / "renamed.bin"
        copied.parent.mkdir()
        copied.write_bytes(self.payload)
        self.index["files"]["walk"]["frames/one.png"]["pathHint"] = copied.relative_to(
            self.root
        ).as_posix()
        self.index["files"]["walk"]["alias.png"] = identity(self.payload)
        resolver = self.resolver(search_roots=[numbered])
        self.assertEqual(resolver.read("file:walk/frames/one.png"), self.payload)
        self.assertEqual(resolver.read("file:walk/alias.png"), self.payload)
        copied.unlink()
        with self.assertRaises(FileNotFoundError):
            resolver.read("file:walk/frames/one.png")

    def test_archive_groups_isolate_identical_member_names_after_archive_rename(self):
        self.index["archiveGroups"] = {"first": "pack.zip", "second": "other.zip"}
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w") as z:
            z.writestr("pack/art.txt", b"other illustration")
        other = buffer.getvalue()
        self.index["archives"]["other.zip"] = identity(other)
        (self.root / "other.zip").write_bytes(other)
        self.move(self.root / "pack.zip", self.library / "renamed.source")
        resolver = self.resolver()
        self.assertEqual(
            read(self.root, self.index, "first", "pack/art.txt", resolver), self.payload
        )
        self.assertEqual(
            read(self.root, self.index, "second", "pack/art.txt", resolver), b"other illustration"
        )

    def test_consolidation_preserves_unique_contents_and_checks_survivors(self):
        numbered = self.root / "00 - Guides and Catalogues"
        numbered.mkdir()
        (numbered / "pack.zip").write_bytes(self.archive)
        (numbered / "notes.txt").write_bytes(b"notes")
        plan = make_plan(self.root)
        self.assertEqual(len(plan["remove"]), 2)
        changed = numbered / "notes.txt"
        changed.write_bytes(b"changed")
        with self.assertRaisesRegex(ValueError, "changed"):
            apply_plan(self.root, self.index, plan)
        self.assertTrue((self.root / "pack.zip").exists())
        changed.write_bytes(b"notes")
        apply_plan(self.root, self.index, plan)
        self.assertFalse((self.root / "pack.zip").exists())
        self.assertFalse(self.loose.exists())
        roots = [p for p in self.root.iterdir() if p.is_dir()]
        self.assertEqual(check_sources(self.root, self.index, roots, fresh=True), 3)

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.base = pathlib.Path(self.temp.name).resolve()
        self.documents = self.base / "Documents"
        self.library = self.documents / "Asset Library"
        self.root = self.library / "2d Assets/Lantern Knight"
        self.root.mkdir(parents=True)
        self.cache = self.base / "cache"
        self.payload = b"unchanged illustration source"
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w") as z:
            z.writestr("pack/art.txt", self.payload)
        self.archive = buffer.getvalue()
        self.index = {
            "schemaVersion": 2,
            "libraryDirectory": "2d Assets/Lantern Knight",
            "archives": {"pack.zip": identity(self.archive)},
            "prefixes": {"pack": ["pack.zip"]},
            "directories": {"walk": "Project Sources/walk"},
            "files": {
                "walk": {"frames/one.png": identity(self.payload)},
                "ink-collection-01": {"collection/notes.txt": identity(b"notes")},
            },
        }
        (self.root / "pack.zip").write_bytes(self.archive)
        self.loose = self.root / "Project Sources/walk/frames/one.png"
        self.loose.parent.mkdir(parents=True)
        self.loose.write_bytes(self.payload)
        (self.root / "notes.txt").write_bytes(b"notes")
        self.index_path = self.base / "sources.json"
        self.index_path.write_text(json.dumps(self.index))

    def tearDown(self):
        self.temp.cleanup()

    def resolver(self, **options):
        return SourceResolver(
            self.root,
            self.index,
            library_root=self.library,
            documents_root=self.documents,
            cache=self.cache,
            **options,
        )

    def move(self, source, destination):
        destination.parent.mkdir(parents=True, exist_ok=True)
        source.rename(destination)
        return destination

    def test_whole_library_move_and_stale_cache(self):
        resolver = self.resolver()
        resolver.read("file:walk/frames/one.png")
        self.library.rename(self.documents / "Reorganized Sources")
        self.assertEqual(resolver.read("file:walk/frames/one.png"), self.payload)
        self.assertEqual(
            read(self.root, self.index, "ink-collection-01", "pack/art.txt", resolver), self.payload
        )
        self.assertEqual(self.resolver().read("file:walk/frames/one.png"), self.payload)
        warm = self.resolver()
        self.assertEqual(
            read(self.root, self.index, "ink-collection-01", "pack/art.txt", warm), self.payload
        )
        self.assertEqual(warm.stats["scans"], 0)
        hashes = warm.stats["hashes"]
        read(self.root, self.index, "ink-collection-01", "pack/art.txt", warm)
        self.assertEqual(warm.stats["hashes"], hashes)

    def test_explicit_file_hints_need_no_shared_directory(self):
        self.index["files"]["walk"]["frames/one.png"]["pathHint"] = self.loose.relative_to(
            self.root
        ).as_posix()
        del self.index["directories"]["walk"]
        resolver = self.resolver(search_roots=[self.root])
        self.assertEqual(resolver.read("file:walk/frames/one.png"), self.payload)
        self.assertEqual(resolver.stats["scans"], 0)
        self.index["files"]["ink-collection-01"]["unregistered.png"] = {
            **identity(self.payload),
            "pathHint": self.loose.relative_to(self.root).as_posix(),
        }
        with self.assertRaisesRegex(ValueError, "only collection sidecars"):
            self.resolver()

    def test_discovery_proofs_skip_duplicate_archive_hashes_but_reject_replacements(self):
        path = self.root / "pack.zip"
        inventory = {
            "discoveryVersion": 8,
            "files": [
                {
                    "path": "pack.zip",
                    **identity(self.archive),
                    "signature": list(signature(path.stat())),
                }
            ],
        }
        resolver = self.resolver(search_roots=[self.root])
        resolver.reuse_inventory(inventory)
        with resolver.open("archive:pack.zip") as stream:
            self.assertEqual(stream.read(), self.archive)
        self.assertEqual(resolver.stats["hashes"], 0)
        # Retaining the byte count and mtime must not authenticate new bytes.
        before = path.stat()
        path.write_bytes(b"x" * len(self.archive))
        os.utime(path, ns=(before.st_atime_ns, before.st_mtime_ns))
        changed = self.resolver(search_roots=[self.root])
        changed.reuse_inventory(inventory)
        with self.assertRaisesRegex(FileNotFoundError, "Missing exact asset source"):
            with changed.open("archive:pack.zip"):
                self.fail("Changed archive must not be admitted")
        self.assertGreater(changed.stats["hashes"], 0)

    def test_cloud_placeholder_fails_before_reading_even_with_a_discovery_proof(self):
        path = self.root / "pack.zip"
        resolver = self.resolver()
        resolver.reuse_inventory(
            {
                "discoveryVersion": 8,
                "files": [
                    {
                        "path": "pack.zip",
                        **identity(self.archive),
                        "signature": list(signature(path.stat())),
                    }
                ],
            }
        )
        original_stat = pathlib.Path.stat

        class PlaceholderStat:
            st_flags = 0x40000000

            def __init__(self, info):
                self.info = info

            def __getattr__(self, name):
                return getattr(self.info, name)

        def local_stat(candidate, *args, **kwargs):
            info = original_stat(candidate, *args, **kwargs)
            return PlaceholderStat(info) if candidate == path else info

        with patch("resolver.sys.platform", "darwin"), patch.object(
            pathlib.Path, "stat", autospec=True, side_effect=local_stat
        ):
            with self.assertRaisesRegex(
                RuntimeError, "Asset source is not downloaded locally.*Download Now"
            ):
                resolver.digest(path)
        self.assertEqual(resolver.stats["hashes"], 0)

    def test_repeated_moves_in_same_reader_and_completed_interrupted_move(self):
        resolver = self.resolver()
        first = self.move(self.loose, self.library / "first")
        self.assertEqual(resolver.read("file:walk/frames/one.png"), self.payload)
        self.move(first, self.library / "second")
        self.assertEqual(resolver.read("file:walk/frames/one.png"), self.payload)
        (self.library / "second").unlink()
        with self.assertRaisesRegex(FileNotFoundError, "file:walk/frames/one.png.*searched"):
            resolver.read("file:walk/frames/one.png")
        (self.root / "restored").write_bytes(self.payload)
        self.assertEqual(resolver.read("file:walk/frames/one.png"), self.payload)

    def test_wrong_revision_identical_duplicates_and_deleted_sources(self):
        self.loose.write_bytes(b"X" * len(self.payload))
        for name in ["z-copy", "a-copy"]:
            (self.library / name).write_bytes(self.payload)
        resolver = self.resolver()
        self.assertEqual(resolver.resolve("file:walk/frames/one.png"), self.library / "a-copy")
        (self.library / "a-copy").unlink()
        (self.library / "z-copy").unlink()
        with self.assertRaisesRegex(FileNotFoundError, "SHA-256"):
            self.resolver().read("file:walk/frames/one.png")

    def test_symlinks_and_exclusions_are_not_followed(self):
        outside = self.base / "outside"
        outside.mkdir()
        self.move(self.loose, outside / "source")
        (self.library / "linked-folder").symlink_to(outside, target_is_directory=True)
        self.loose.symlink_to(outside / "source")
        skipped = self.library / "node_modules"
        skipped.mkdir()
        (skipped / "copy").write_bytes(self.payload)
        excluded = self.documents / "another-project"
        excluded.mkdir()
        (excluded / "copy").write_bytes(self.payload)
        with self.assertRaises(FileNotFoundError):
            self.resolver(excluded=[excluded]).read("file:walk/frames/one.png")
        with self.assertRaisesRegex(ValueError, "unsafe"):
            read(self.root, self.index, "walk", "../outside/source", self.resolver())

    def test_inaccessible_directory_does_not_block_recovery(self):
        extra = self.base / "external"
        extra.mkdir()
        moved = self.move(self.loose, extra / "valid/source")
        denied = self.library / "denied"
        denied.mkdir()
        original = os.scandir

        def scandir(path):
            if pathlib.Path(path) == denied:
                raise PermissionError("fixture permission denied")
            return original(path)

        with (
            patch("os.scandir", side_effect=scandir),
            patch.dict(os.environ, {"LANTERN_SOURCE_SEARCH_ROOTS": str(extra)}),
        ):
            self.assertEqual(self.resolver(search_roots=[self.root, self.library, extra]).resolve("file:walk/frames/one.png"), moved)

    def test_corrupt_cache_and_concurrent_normal_reader_commands(self):
        self.move(self.loose, self.root / "moved/source")
        self.cache.mkdir()
        (self.cache / "source-locations.json").write_text("{interrupted")
        env = {
            **os.environ,
            "LANTERN_CACHE_ROOT": str(self.cache),
            "HOME": str(self.base),
            "ASSET_LIBRARY_ROOT": str(self.library),
        }
        command = [
            "python3",
            "-B",
            str(PROJECT / "tools/assets/source.py"),
            str(self.root),
            str(self.index_path),
            "walk",
            "frames/one.png",
        ]
        children = [
            subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env)
            for _ in range(4)
        ]
        for child in children:
            stdout, stderr = child.communicate(timeout=15)
            self.assertEqual(child.returncode, 0, stderr.decode())
            self.assertEqual(stdout, self.payload)
        stored = json.loads((self.cache / "source-locations.json").read_text())
        self.assertEqual(stored["schemaVersion"], 1)
        self.assertEqual(len(stored["locations"]), 3)
        self.assertFalse(list(self.cache.glob(".source-locations-*")))

    def test_open_retries_move_between_resolution_and_consumption(self):
        resolver = self.resolver()
        original = resolver.resolve
        calls = 0

        def resolve(key):
            nonlocal calls
            result = original(key)
            if calls == 0:
                self.move(result, self.library / "moved-during-open")
            calls += 1
            return result

        with patch.object(resolver, "resolve", side_effect=resolve):
            self.assertEqual(resolver.read("file:walk/frames/one.png"), self.payload)
        self.assertEqual(calls, 2)

    def test_worker_handles_multiple_requests_and_missing_then_restored(self):
        env = {
            **os.environ,
            "LANTERN_CACHE_ROOT": str(self.cache),
            "ASSET_LIBRARY_ROOT": str(self.library),
            "HOME": str(self.base),
        }
        child = subprocess.Popen(
            ["python3", "-B", str(PROJECT / "tools/assets/source.py"), "--serve"],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            env=env,
        )
        try:

            def request(number):
                child.stdin.write(
                    json.dumps(
                        {
                            "id": number,
                            "root": str(self.root),
                            "index": str(self.index_path),
                            "group": "walk",
                            "member": "frames/one.png",
                        }
                    )
                    + "\n"
                )
                child.stdin.flush()
                return json.loads(child.stdout.readline())

            self.assertIn("data", request(1))
            self.loose.unlink()
            self.assertIn("error", request(2))
            (self.root / "restored").write_bytes(self.payload)
            self.assertIn("data", request(3))
            child.stdin.close()
            child.wait(timeout=10)
            self.assertEqual(child.returncode, 0)
        finally:
            if child.poll() is None:
                child.kill()
                child.wait()
            child.stdout.close()
            child.stderr.close()

    def test_moved_archive_health_check_preserves_registered_identities(self):
        before = self.index.copy()
        self.assertEqual(check_sources(self.root, self.index), 3)
        moved = self.move(self.root / "pack.zip", self.documents / "moved/archive.bin")
        resolver = self.resolver()
        self.assertEqual(resolver.read("archive:pack.zip"), self.archive)
        self.assertEqual(self.index, before)
        self.assertEqual(identity(moved.read_bytes()), identity(self.archive))


if __name__ == "__main__":
    unittest.main()
