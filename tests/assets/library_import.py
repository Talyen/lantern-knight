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
    def test_package_rejects_duplicate_members_and_unsafe_source_paths(self):
        stream = io.BytesIO()
        with zipfile.ZipFile(stream, "w") as archive:
            archive.writestr("art.png", png(8, 8))
            with self.assertWarns(UserWarning):
                archive.writestr("art.png", png(8, 8))
        stream.seek(0)
        with zipfile.ZipFile(stream) as archive:
            with self.assertRaisesRegex(ValueError, "Duplicate archive member"):
                Package({"archive": "duplicate.zip"}, archive)
        p = package({"art.png": png(8, 8)})
        for name in ["../escape", "/absolute.png", "folder/../art.png", "folder\\art.png"]:
            with self.subTest(name=name), self.assertRaises(ValueError):
                p.reference(name)
        with self.assertRaisesRegex(ValueError, "missing"):
            p.reference("missing.png")

    def test_terminal_tick_marker_rounding_keeps_strict_timeline_bounds(self):
        importer = Importer([])
        asset = {"id": "recovery", "clips": {}}
        durations = [tick * 1000 / 60 for tick in [3, 4, 4, 4, 5, 8]]
        marker = {"id": "hold", "atMs": 28 * 1000 / 60}
        importer.clip(asset, "recovery", "d45", [{}] * 6, durations, markers=[marker])
        clip = asset["clips"]["recovery"]["d45"]
        self.assertEqual(clip["markers"][0]["atMs"], sum(durations))
        self.assertEqual(clip["durationsMs"], durations)
        with self.assertRaisesRegex(ValueError, "event outside supplied timeline"):
            importer.clip(asset, "invalid", "d45", [{}] * 6, durations,
                          markers=[{**marker, "atMs": marker["atMs"] + 0.001}])

    def test_dual_export_uses_local_frame_bounds_and_keeps_atlas_slices(self):
        p = package({"frame.png": png(8, 8), "atlas.png": png(16, 8)})
        importer = Importer([p])
        context = {
            "atlas": "atlas.png",
            "canvas": [8, 8],
            "pivot_px": [4, 7],
            "pixels_per_unit": 256,
        }
        record = {"file": "frame.png", "rect": [8, 0, 8, 8]}
        frame = importer.frame(p, record, [context])
        self.assertEqual(frame["member"], "frame.png")
        self.assertEqual(frame["rect"], [0, 0, 8, 8])
        self.assertEqual(frame["anchor"], [4, 7])
        atlas = importer.frame(p, {**record, "file": "atlas.png"}, [context])
        self.assertEqual(atlas["rect"], [8, 0, 8, 8])

    def test_native_camel_case_holds_preserve_events_without_guessing_frames(self):
        p = package({"frames/one.png": png(8, 8), "frames/two.png": png(8, 8)})
        meta = {
            "canvas": [8, 8],
            "pivotPixels": [4, 7],
            "fps": 60,
            "frames": [
                {"file": "frames/one.png", "holdTicks": 20},
                {"file": "frames/two.png", "holdTicks": 40},
            ],
            "events": [{"name": "loot_release", "tick": 25}],
        }
        asset = Importer([p]).animation(
            p, "manifest.json", meta, "desk", defaults={"pixels_per_unit": 256}
        )
        clip = asset["clips"]["animation"]["d45"]
        self.assertEqual(clip["durationsMs"], [20 * 1000 / 60, 40 * 1000 / 60])
        self.assertEqual(clip["markers"], [{"id": "loot_release", "atMs": 25 * 1000 / 60}])
        meta["events"][0]["tick"] = 90
        with self.assertRaisesRegex(ValueError, "event outside supplied timeline"):
            Importer([p]).animation(
                p, "manifest.json", meta, "desk", defaults={"pixels_per_unit": 256}
            )

    def test_timed_effect_preserves_alternate_timelines_contact_and_clear_hold(self):
        meta = {
            "pivot_pixels": [3, 8],
            "timelines": {
                "enemy": {
                    "entries": [
                        {"file": "frames/00.png", "duration_ms": 85},
                        {"file": "frames/01.png", "duration_ms": 90, "damage_event": True},
                        {"file": "frames/00.png", "duration_ms": 40},
                        {"file": "frames/02.png", "duration_ms": 350},
                    ]
                },
                "hero": {
                    "entries": [
                        {"file": "frames/01.png", "duration_ms": 30, "damage_event": True},
                        {"file": "frames/02.png", "duration_ms": 350},
                    ]
                },
            },
        }
        p = package(
            {
                "fx/timing.json": json.dumps(meta),
                **{f"fx/frames/{i:02d}.png": png(10, 10) for i in range(3)},
            }
        )
        p.spec.update(
            format="timed-effects", manifest="fx/timing.json", identity="test", label="Test"
        )
        importer = Importer([p])
        importer.package(p)
        clips = importer.assets["library-test"]["clips"]
        enemy, hero = clips["enemy"]["d45"], clips["hero"]["d45"]
        self.assertEqual(enemy["durationsMs"], [85, 90, 40, 350])
        self.assertEqual(enemy["frames"][0], enemy["frames"][2])
        self.assertEqual(enemy["frames"][0]["anchor"], [3, 8])
        self.assertEqual(enemy["frames"][-1]["member"], "fx/frames/02.png")
        self.assertEqual(enemy["markers"], [{"id": "contact", "atMs": 85}])
        self.assertEqual(hero["markers"], [{"id": "contact", "atMs": 0}])
        self.assertEqual(enemy["endBehavior"], "hide")
        self.assertFalse(enemy["loop"])

    def test_numbered_effect_requires_timing_for_every_delivered_frame(self):
        p = package(
            {
                "fx/timing.json": json.dumps({"durations_ms": [40, 500], "loop": True}),
                "fx/frames/00.png": png(10, 10),
                "fx/frames/01.png": png(10, 10),
            }
        )
        p.spec.update(
            format="timed-effects", manifest="fx/timing.json", identity="test", label="Test"
        )
        importer = Importer([p])
        importer.package(p)
        c = importer.assets["library-test"]["clips"]["show"]["d45"]
        self.assertEqual(c["durationsMs"], [40, 500])
        self.assertTrue(c["loop"])
        self.assertEqual(c["endBehavior"], "hold")
        self.assertEqual(c["frames"][0]["anchor"], [5, 5])
        p.names.add("fx/frames/02.png")
        with self.assertRaisesRegex(ValueError, "timing does not cover exact frames"):
            Importer([p]).package(p)

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
