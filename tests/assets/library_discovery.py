"""Coverage reconciliation uses only the active library, including archived originals."""

import hashlib
import io
import json
import pathlib
import sys
import tempfile
import unittest
import zipfile
from PIL import Image

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2] / "tools/assets"))
from discovery import discover
from resolver import SourceResolver


class DiscoveryTests(unittest.TestCase):
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
