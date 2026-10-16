"""Coverage reconciliation uses only the active library, including archived originals."""

import hashlib
import copy
import io
import json
import pathlib
import sys
import tempfile
import unittest
import zipfile
from unittest.mock import patch
from PIL import Image

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2] / "tools/assets"))
from discovery import discover
from library_import import build
from resolver import SourceResolver
from source import read
from source_members import metadata_file


class DiscoveryTests(unittest.TestCase):
    def test_local_members_and_durable_metadata_rebuild_without_zip_or_disposable_cache(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = pathlib.Path(temporary).resolve()
            output = io.BytesIO()
            Image.new("RGBA", (8, 8), "red").save(output, format="PNG")
            pixels = output.getvalue()
            metadata = json.dumps(
                {
                    "canvas": [8, 8],
                    "pivotPixels": [4, 7],
                    "frames": [{"file": "frame.png", "duration_ms": 120}],
                }
            ).encode()
            archive_path = root / "supplied.zip"
            with zipfile.ZipFile(archive_path, "w") as archive:
                archive.writestr("frame.png", pixels)
                archive.writestr("animation.json", metadata)
            loose = root / "renamed-artwork.png"
            loose.write_bytes(pixels)
            original = {"libraryDirectory": "Test", "archives": {}, "files": {}, "prefixes": {}}
            index, inventory = discover(root, original)
            retained = {
                "schemaVersion": 1,
                "sourceSnapshot": {
                    "discoveryVersion": 8,
                    "files": copy.deepcopy(inventory["files"]),
                },
            }
            (root / ".lantern/identities.json").write_text(json.dumps(retained))
            archive_record = next(
                r for r in retained["sourceSnapshot"]["files"] if r["kind"] == "archive"
            )
            manifest = next(m for m in archive_record["members"] if m["member"] == "animation.json")
            self.assertEqual(metadata_file(root, manifest).read_bytes(), metadata)
            expected = build(
                root, [], index, inventory=copy.deepcopy(inventory), index_path=root / "index.json"
            )
            group = "discovered-" + archive_record["sha256"][:24]
            # Simulate unavailable ZIPs after all disposable discovery/producer
            # caches are gone. No test changes the real library or cloud flags.
            with patch("zipfile.ZipFile", side_effect=AssertionError("ZIP should not be opened")):
                restored_index, restored_inventory = discover(root, original, identities=retained)
                self.assertEqual(restored_inventory["sha256"], inventory["sha256"])
                actual = build(
                    root,
                    [],
                    restored_index,
                    inventory=copy.deepcopy(restored_inventory),
                    index_path=root / "index.json",
                )
                self.assertEqual(actual, expected)
                self.assertEqual(read(root, restored_index, group, "frame.png"), pixels)
                # Authored indices can also use the library's durable member table.
                authored = {
                    "libraryDirectory": "Test",
                    "archives": {
                        "pack.zip": {
                            "sha256": archive_record["sha256"],
                            "bytes": archive_record["bytes"],
                            "pathHint": "supplied.zip",
                        }
                    },
                    "archiveGroups": {"fixture": "pack.zip"},
                    "files": {},
                }
                self.assertEqual(read(root, authored, "fixture", "frame.png"), pixels)
            # A changed loose copy cannot impersonate the recorded original.
            loose.write_bytes(b"x" * len(pixels))
            with patch.object(SourceResolver, "open", side_effect=RuntimeError("ZIP unavailable")):
                with self.assertRaisesRegex(RuntimeError, "ZIP unavailable"):
                    read(root, index, group, "frame.png")
            self.assertEqual(read(root, index, group, "frame.png"), pixels)
            loose.write_bytes(pixels)
            # Corrupt retained metadata is rejected and recovered only from a
            # verified original; it cannot silently remove animation coverage.
            metadata_file(root, manifest).write_bytes(b"x" * len(metadata))
            with patch.object(SourceResolver, "open", side_effect=RuntimeError("ZIP unavailable")):
                with self.assertRaisesRegex(RuntimeError, "ZIP unavailable"):
                    build(
                        root,
                        [],
                        index,
                        inventory=copy.deepcopy(inventory),
                        index_path=root / "index.json",
                    )
            discover(root, original, inventory)
            self.assertEqual(metadata_file(root, manifest).read_bytes(), metadata)
            archive_path.unlink()
            deleted_index, deleted = discover(root, original, identities=retained)
            result = build(
                root, [], deleted_index, inventory=deleted, index_path=root / "index.json"
            )
            self.assertEqual(deleted_index["archives"], {})
            self.assertFalse(
                any(a["id"].startswith("library-animation-") for a in result["assets"])
            )

    def test_malformed_discovered_sequences_preserve_sibling_artwork_and_report_diagnostics(self):
        malformed = [
            {'atlas': {'file': 'atlas.png', 'rects': []}, 'frames': [{'duration_ticks': 1}]},
            {'atlas': None, 'frames': [{'duration_ticks': 1}]},
            {'frames': [None]},
        ]
        for archived in [False, True]:
            for clip in malformed:
                with self.subTest(archived=archived, clip=clip), tempfile.TemporaryDirectory() as temporary:
                    root = pathlib.Path(temporary).resolve()
                    output = io.BytesIO()
                    Image.new('RGBA', (8, 8), 'red').save(output, format='PNG')
                    data = {
                        'canvas': [8, 8], 'pivot_px': [4, 7],
                        'rest': {'file': 'atlas.png'}, 'drop': clip,
                        'idle': {'frames': [{'file': 'atlas.png', 'duration_ms': 100}]},
                    }
                    files = {'animation.json': json.dumps(data).encode(), 'atlas.png': output.getvalue()}
                    if archived:
                        with zipfile.ZipFile(root / 'supplied.zip', 'w') as archive:
                            for name, value in files.items():
                                archive.writestr(name, value)
                    else:
                        for name, value in files.items():
                            (root / name).write_bytes(value)
                    original = {'libraryDirectory': 'Test', 'archives': {}, 'files': {}, 'prefixes': {}}
                    index, inventory = discover(root, original)
                    result = build(root, [], index, inventory=inventory, index_path=root / 'index.json')
                    self.assertEqual(len(inventory['unresolvedAnimations']), 1)
                    self.assertEqual(inventory['unresolvedAnimations'][0]['metadata'], 'animation.json')
                    self.assertTrue(inventory['unresolvedAnimations'][0]['reason'])
                    self.assertTrue(inventory['images'][0]['assets'])
                    self.assertEqual(len(result['assets']), 1)

    def test_animated_png_and_webp_remain_native_media_after_cached_refresh(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = pathlib.Path(temporary).resolve()
            for extension, format in [('png', 'PNG'), ('webp', 'WEBP')]:
                output = io.BytesIO()
                Image.new('RGBA', (8, 8), 'red').save(
                    output, format=format, save_all=True,
                    append_images=[Image.new('RGBA', (8, 8), 'blue')],
                    duration=[100, 200], loop=0,
                )
                (root / ('animation.' + extension)).write_bytes(output.getvalue())
            with zipfile.ZipFile(root / 'animations.zip', 'w') as archive:
                archive.writestr('animation.png', (root / 'animation.png').read_bytes())
            original = {'libraryDirectory': 'Test', 'archives': {}, 'files': {}, 'prefixes': {}}
            _, inventory = discover(root, original)
            self.assertEqual(len(inventory['images']), 0)
            self.assertEqual(len(inventory['media']), 2)
            self.assertTrue(all(m['animated'] for m in inventory['media']))
            # Older snapshots cached still-image metadata even for these same bytes.
            legacy = json.loads(json.dumps(inventory))
            legacy['discoveryVersion'] = 7
            for record in legacy['files']:
                if 'image' in record:
                    record['image']['animated'] = False
                for member in record.get('members', []):
                    member['animated'] = False
            _, refreshed = discover(root, original, legacy)
            self.assertEqual(refreshed['images'], [])
            self.assertTrue(all(m['animated'] for m in refreshed['media']))
            self.assertTrue(next(r for r in refreshed['files'] if r['kind'] == 'archive')['members'][0]['animated'])

    def test_retained_archive_timelines_keep_distinct_bindings_across_moves(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = pathlib.Path(temporary).resolve()
            def write_archive(file, color, duration):
                output = io.BytesIO()
                Image.new('RGBA', (8, 8), color).save(output, format='PNG')
                with zipfile.ZipFile(file, 'w') as archive:
                    archive.writestr('frame.png', output.getvalue())
                    archive.writestr('meta.json', json.dumps({
                        'canvas': [8, 8], 'pivotPixels': [4, 7],
                        'frames': [{'file': 'frame.png', 'duration_ms': duration}],
                    }))
            original = {'libraryDirectory': 'Test', 'archives': {}, 'files': {}, 'prefixes': {}}
            write_archive(root / 'current.zip', 'red', 100)
            _, before = discover(root, original)
            identity = before['files'][0]['assetIdentity']
            (root / 'current.zip').rename(root / 'retained.zip')
            write_archive(root / 'current.zip', 'blue', 200)
            index, changed = discover(root, original, before)
            self.assertEqual(len({r['assetIdentity'] for r in changed['files']}), 2)
            self.assertEqual(next(r for r in changed['files'] if r['path'] == 'current.zip')['assetIdentity'], identity)
            def animations(index, inventory):
                result = build(root, [], index, inventory=inventory, index_path=root / 'index.json')
                return {a['id']: next(iter(a['clips'].values()))['d45']['durationsMs']
                        for a in result['assets'] if a['id'].startswith('library-animation-')}
            expected = animations(index, json.loads(json.dumps(changed)))
            self.assertEqual(sorted(expected.values()), [[100], [200]])
            (root / 'current.zip').rename(root / 'moved.zip')
            moved_index, moved = discover(root, original, changed)
            self.assertEqual(animations(moved_index, json.loads(json.dumps(moved))), expected)
            registry = {'archives': [{k: r[k] for k in ('path', 'sha256', 'assetIdentity')} for r in moved['files']]}
            cold_index, cold = discover(root, original, identities=registry)
            self.assertEqual(animations(cold_index, cold), expected)
            # Importing conflicting IDs must fail instead of hiding one timeline.
            for archive in cold_index['archives'].values():
                archive['assetIdentity'] = identity
            with self.assertRaisesRegex(ValueError, 'Conflicting discovered animation identities'):
                animations(cold_index, cold)

    def test_replacements_moves_and_retained_versions_keep_distinct_stable_ids(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = pathlib.Path(temporary)
            def drawing(size, color):
                output = io.BytesIO()
                Image.new('RGBA', size, color).save(output, format='PNG')
                return output.getvalue()
            first = drawing((8, 4), (10, 20, 30, 255))
            second = drawing((16, 8), (90, 30, 40, 255))
            (root / 'master.png').write_bytes(first)
            registered = {'libraryDirectory': 'Test', 'archives': {}, 'files': {'known': {
                'master.png': {'sha256': hashlib.sha256(first).hexdigest(), 'bytes': len(first), 'pathHint': 'master.png'}}}}
            _, before = discover(root, registered)
            identity = before['images'][0]['assetIdentity']
            (root / 'master.png').write_bytes(second)
            (root / 'retained.png').write_bytes(first)
            index, changed = discover(root, registered, before)
            self.assertEqual(index['files']['known']['master.png']['sha256'], hashlib.sha256(second).hexdigest())
            self.assertEqual(len({i['assetIdentity'] for i in changed['images']}), 2)
            self.assertEqual(next(i for i in changed['images'] if i['path'] == 'master.png')['assetIdentity'], identity)
            (root / 'master.png').rename(root / 'moved.png')
            moved_index, moved = discover(root, registered, changed)
            self.assertEqual(moved_index['files']['known']['master.png']['sha256'], hashlib.sha256(second).hexdigest())
            self.assertEqual(next(i for i in moved['images'] if i['path'] == 'moved.png')['assetIdentity'], identity)
            registry = {'images': [{k: i[k] for k in ('path', 'sha256', 'assetIdentity')} for i in moved['images']]}
            cold_index, cold = discover(root, registered, identities=registry)
            self.assertEqual(cold_index['files']['known']['master.png']['sha256'], hashlib.sha256(second).hexdigest())
            self.assertEqual(discover(root, registered, cold, registry)[1]['sha256'], cold['sha256'])
            self.assertEqual({i['sha256']: i['assetIdentity'] for i in cold['images']}, {i['sha256']: i['assetIdentity'] for i in moved['images']})
            archive = root / 'animation.zip'
            with zipfile.ZipFile(archive, 'w') as z:
                z.writestr('frame.png', first)
            registered['archives']['animation.zip'] = {'sha256': hashlib.sha256(archive.read_bytes()).hexdigest(), 'bytes': archive.stat().st_size, 'pathHint': archive.name}
            _, prior_archive = discover(root, registered, cold)
            with zipfile.ZipFile(archive, 'w') as z:
                z.writestr('frame.png', second)
            _, changed_archive = discover(root, registered, prior_archive)
            archive.rename(root / 'moved-animation.zip')
            moved_archive_index, _ = discover(root, registered, changed_archive)
            self.assertEqual(moved_archive_index['archives']['animation.zip']['sha256'], hashlib.sha256((root / 'moved-animation.zip').read_bytes()).hexdigest())
            self.assertEqual(moved_archive_index['archives']['animation.zip']['pathHint'], 'moved-animation.zip')

    def test_all_versions_moves_deletions_and_archived_aliases(self):
        with tempfile.TemporaryDirectory() as temporary:
            base = pathlib.Path(temporary).resolve()
            root = base / "active"
            root.mkdir()

            def drawing(size):
                output = io.BytesIO()
                Image.new("RGBA", size, (10, 20, 30, 255)).save(output, format="PNG")
                return output.getvalue()

            original = drawing((8, 4))
            large = drawing((16, 8))
            original_hash = hashlib.sha256(original).hexdigest()
            (root / "Rejected").mkdir()
            (root / "Rejected" / "master.png").write_bytes(large)
            (root / "low.png").write_bytes(original)
            (root / "copy.png").write_bytes(original)
            (root / "movie.mp4").write_bytes(b"native media bytes")
            (root / "original.svg").write_text(
                '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="4"/>'
            )
            with zipfile.ZipFile(root / "sources.zip", "w") as archive:
                archive.writestr("original.png", original)
            registered = {
                "libraryDirectory": "Test",
                "archives": {},
                "files": {
                    "known": {
                        "original.png": {
                            "sha256": original_hash,
                            "bytes": len(original),
                            "pathHint": "low.png",
                        }
                    }
                },
            }
            index, inventory = discover(root, registered)
            self.assertEqual(len(inventory["images"]), 2)
            self.assertEqual(len(inventory["media"]), 2)
            self.assertFalse(inventory["problems"])
            (root / "low.png").unlink()
            (root / "copy.png").unlink()
            index, moved = discover(root, registered, inventory)
            self.assertEqual(len(moved["images"]), 2)
            self.assertIn("archive", index["files"]["known"]["original.png"])
            index_file = base / "index.json"
            index_file.write_text(json.dumps(index))
            resolver = SourceResolver(root, index, search_roots=[root])
            with resolver.open("file:known/original.png") as source:
                self.assertEqual(source.read(), original)
            (root / "sources.zip").unlink()
            (base / "outside.png").write_bytes(original)
            index, deleted = discover(root, registered, moved)
            self.assertNotIn("original.png", index["files"]["known"])
            self.assertEqual(len(deleted["images"]), 1)
            self.assertTrue(deleted["missingRegisteredSources"])


if __name__ == "__main__":
    unittest.main()
