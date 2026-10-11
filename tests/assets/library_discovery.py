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
