"""Consequential importer contracts with tiny synthetic archives, no library access."""

import io
import json
import pathlib
import struct
import sys
import unittest
import zipfile

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2] / "tools/assets"))
from library_import import Package, Importer


def package(files):
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, "w") as z:
        for name, data in files.items():
            z.writestr(name, data)
    stream.seek(0)
    return Package(
        {"group": "fixture", "archive": "fixture.zip", "category": 2}, zipfile.ZipFile(stream)
    )


def png(w, h):
    return b"\x89PNG\r\n\x1a\n" + struct.pack(">I", 13) + b"IHDR" + struct.pack(">II", w, h)


class ImportTests(unittest.TestCase):
    def test_delivered_atlas_preserves_repeated_cells_holds_and_pivot(self):
        meta = {
            "cell_size": [10, 20],
            "atlas": "atlas.png",
            "columns": 2,
            "pivot_pixels_top_left": [4, 18],
            "suggested_pixels_per_unit": 100,
            "timing_hz": 60,
            "animation": {
                "name": "tea",
                "frames": [0, 1, 0],
                "duration_ticks": [12, 3, 9],
                "loop": True,
            },
        }
        p = package({"runtime/animation.json": json.dumps(meta), "runtime/atlas.png": png(20, 20)})
        p.spec.update(
            format="atlas-actor",
            manifest="runtime/animation.json",
            identity="headsman",
            kind="character",
        )
        importer = Importer([p])
        importer.package(p)
        c = importer.assets["library-headsman"]["clips"]["tea"]["d45"]
        self.assertEqual(c["durationsMs"], [200, 50, 150])
        self.assertEqual(
            [f["rect"] for f in c["frames"]], [[0, 0, 10, 20], [10, 0, 10, 20], [0, 0, 10, 20]]
        )
        self.assertEqual(c["frames"][0]["anchor"], [4, 18])
        self.assertEqual(c["frames"][0]["density"], 100)
        self.assertTrue(c["loop"])

    def test_delivered_prop_preserves_one_shot_and_held_states(self):
        meta = {
            "name": "desk",
            "canvas": [10, 20],
            "pivotPixels": [4, 18],
            "suggestedPixelsPerUnit": 100,
            "frames": [{"file": "a.png", "holdTicks": 9}, {"file": "b.png", "holdTicks": 27}],
            "events": [{"name": "loot_release", "tick": 9}],
        }
        p = package(
            {
                "runtime/manifest.json": json.dumps(meta),
                "runtime/a.png": png(10, 20),
                "runtime/b.png": png(10, 20),
            }
        )
        p.spec.update(format="frame-props", manifest="runtime/manifest.json", identity="desk")
        importer = Importer([p])
        importer.package(p)
        clips = importer.assets["library-desk_opening"]["clips"]
        self.assertFalse(clips["search"]["d45"]["loop"])
        self.assertEqual(clips["search"]["d45"]["durationsMs"], [150, 450])
        self.assertEqual(clips["search"]["d45"]["markers"], [{"id": "loot_release", "atMs": 150}])
        self.assertEqual(clips["looted"]["d45"]["frames"][0]["member"], "runtime/b.png")

    def test_mixed_registration_and_repeated_cel_timing(self):
        p = package({"runtime/a.png": png(400, 620), "runtime/b.png": png(600, 700)})
        importer = Importer([p])
        data = {
            "pixels_per_unit": 200,
            "pivot_pixels": [200, 550],
            "clips": {
                "hit": {
                    "loop": False,
                    "frames": [
                        {
                            "file": "a.png",
                            "canvas": [400, 620],
                            "root_pixels": [204, 554],
                            "ppu_relative_v02": 1,
                        },
                        {
                            "file": "b.png",
                            "canvas": [600, 700],
                            "root_pixels": [300, 600],
                            "ppu_relative_v02": 1.1,
                        },
                    ],
                    "timeline": [
                        {"cel": 0, "hold_ticks": 8},
                        {"cel": 1, "hold_ticks": 4},
                        {"cel": 0, "hold_ticks": 10},
                    ],
                }
            },
        }
        a = importer.animation(
            p, "runtime/animation.json", data, "oracle", kind="character", heading="d90"
        )
        c = a["clips"]["hit"]["d90"]
        self.assertEqual([f["canvas"] for f in c["frames"]], [[400, 620], [600, 700], [400, 620]])
        self.assertEqual([f["anchor"] for f in c["frames"]], [[204, 554], [300, 600], [204, 554]])
        for frame, expected in zip(c["frames"], [200, 220, 200]):
            self.assertAlmostEqual(frame["density"], expected)
        self.assertEqual(c["durationsMs"], [8 * 1000 / 60, 4 * 1000 / 60, 10 * 1000 / 60])
        self.assertEqual(list(a["clips"]["hit"]), ["d90"])

    def test_extensions_never_replace_existing_headings(self):
        importer = Importer([])
        a = importer.asset("actor", "Actor", "character")
        f = {
            "canvas": [10, 10],
            "anchor": [5, 9],
            "density": 256,
            "group": "fixture",
            "member": "a.png",
        }
        importer.clip(a, "move", "d90", [f], [100], True)
        importer.clip(a, "move", "d00", [f], [100], True)
        self.assertEqual(list(a["clips"]["move"]), ["d90", "d00"])
        with self.assertRaisesRegex(ValueError, "Conflicting current clip"):
            importer.clip(a, "move", "d90", [f], [200], True)

    def test_explicit_rectangles_and_missing_members(self):
        p = package({"runtime/atlas.png": png(100, 100)})
        importer = Importer([p])
        f = importer.frame(
            p,
            {
                "file": "atlas.png",
                "canvas": [40, 50],
                "pivot": [20, 45],
                "rect": [4, 6, 40, 50],
                "trim": [0, 0, 40, 50],
            },
            [],
            base="runtime",
            density=200,
        )
        self.assertEqual(f["canvas"], [40, 50])
        self.assertEqual(f["rect"], [4, 6, 40, 50])
        with self.assertRaisesRegex(ValueError, "missing"):
            p.locate("missing.png")


if __name__ == "__main__":
    unittest.main()
