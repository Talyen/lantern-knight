"""Consequential importer contracts with tiny synthetic archives, no library access."""

import io
import json
import pathlib
import struct
import sys
import unittest
import zipfile

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2] / "tools/assets"))
from library_import import Package, Importer, LoosePackage, animation_contract
from library_sequences import supplied_sequences, interactable_sequences


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
    def test_scene_opening_manifests_preserve_supplied_order_timing_pivots_and_final_state(self):
        cases = [
            {
                "frame_count": 3,
                "frame_ms": [100, 120, 200],
                "loop": False,
                "on_complete": "hold frame 2 indefinitely",
                "native_canvas": [16, 16],
                "anchor_native": [8, 15],
                "runtime_anchor": [4, 7],
            },
            {
                "frames": 3,
                "duration_ms": [100, 120, 200],
                "loop": False,
                "on_complete": "hold_final_frame",
                "native_anchor_pixels": [8, 15],
                "anchor_pixels": [4, 7],
                "runtime_canvas": [8, 8],
                "frame_files": [
                    "runtime_frames/02.png",
                    "runtime_frames/00.png",
                    "runtime_frames/01.png",
                ],
            },
            {
                "frame_count": 3,
                "animation": {
                    "loop": False,
                    "hold_final": True,
                    "frame_durations_ms": [100, 120, 200],
                },
                "native_frame_size": [16, 16],
                "runtime_frame_size": [8, 8],
                "native_anchor_bottom_contact": [8, 15],
                "runtime_anchor_bottom_contact": [4, 7],
            },
        ]
        cases.append({**cases[0], "native_anchor": cases[0]["anchor_native"]})
        del cases[-1]["anchor_native"]
        for data in cases:
            data = {**data, "scene": 1}
            with self.subTest(data=data):
                p = package(
                    {
                        f"{variant}_frames/{i:02d}.png": png(size, size)
                        for variant, size in [("native", 16), ("runtime", 8)]
                        for i in range(3)
                    }
                )
                self.assertIsNone(interactable_sequences(p, "manifest.json", data))
                p.names.update(["closed.png", "open.png"])
                variants = interactable_sequences(p, "manifest.json", data)
                importer = Importer([p])
                for name, record in variants:
                    importer.animation(p, "manifest.json", record, name)
                    variant = name.rsplit("-", 1)[1]
                    order = [2, 0, 1] if "frame_files" in data else [0, 1, 2]
                    clip = record["clips"]["open"]
                    self.assertEqual(
                        [f["file"] for f in clip["frames"]],
                        [f"{variant}_frames/{i:02d}.png" for i in order],
                    )
                    self.assertEqual([f["duration_ms"] for f in clip["frames"]], [100, 120, 200])
                    self.assertEqual(record["pivot_px"], [8, 15] if variant == "native" else [4, 7])
                    self.assertEqual(record["pixels_per_unit"], 512 if variant == "native" else 256)
                    self.assertEqual(clip["end_behavior"], "hold")
                    self.assertEqual(
                        record["clips"]["opened"]["frames"][0]["file"],
                        f"{variant}_frames/{order[-1]:02d}.png",
                    )
                self.assertEqual(len(importer.assets), 2)
                with self.assertRaises(ValueError):
                    interactable_sequences(p, "manifest.json", {**data, "loop": True})
                p.names.remove("native_frames/01.png")
                with self.assertRaises(ValueError):
                    interactable_sequences(p, "manifest.json", data)

    def test_scene_props_keep_separate_native_and_runtime_playback_and_terminal_holds(self):
        data = {
            "crate": {
                "action": "open",
                "frame_count": 3,
                "native_cell": [16, 16],
                "runtime_cell": [8, 8],
                "pivot_native": [8, 15],
                "pivot_runtime": [4, 7.5],
                "durations_ms": [100, 130, 0],
            }
        }
        p = package(
            {
                f"pack/{v}/crate_{i:02d}.png": png(size, size)
                for v, size in [("native", 16), ("runtime", 8)]
                for i in range(3)
            }
        )
        original = json.dumps(data)
        variants = interactable_sequences(p, "pack/timing.json", data)
        importer = Importer([p])
        for name, record in variants:
            importer.animation(p, "pack/timing.json", record, name)
        self.assertEqual(len(importer.assets), 2)
        for asset, (name, record) in zip(importer.assets.values(), variants):
            self.assertEqual(set(asset["clips"]), {"open", "closed", "opened"})
            clip = asset["clips"]["open"]["d45"]
            self.assertEqual(clip["durationsMs"], [100, 130, 1000 / 60])
            self.assertFalse(clip["loop"])
            self.assertEqual(clip["endBehavior"], "hold")
            self.assertEqual(
                [f["member"] for f in clip["frames"]],
                [f"pack/{name.split('-')[-1]}/crate_{i:02d}.png" for i in range(3)],
            )
            self.assertTrue(all(f["anchor"] == record["pivot_px"] for f in clip["frames"]))
            self.assertEqual(clip["frames"][0]["canvas"][0] / clip["frames"][0]["density"], 8 / 256)
        self.assertEqual(json.dumps(data), original)
        p.names.remove("pack/native/crate_01.png")
        with self.assertRaisesRegex(ValueError, "missing"):
            interactable_sequences(p, "pack/timing.json", data)

    def test_interactable_external_release_splits_segments_and_scales_native_pivot(self):
        data = {
            "name": "trial",
            "native_canvas": [16, 20],
            "runtime_canvas": [8, 10],
            "ground_anchor_native": [8, 18],
            "authored_cels": 4,
            "frame_duration_ms": [100, 0, 200, 0],
            "segments": {"arm": [0, 1], "completion": [2, 3]},
            "holds": {"ready": 0, "armed": 1, "completed": 3},
            "completion_frame": 3,
        }
        p = package(
            {
                f"{v}/{i:02d}_state.png": png(w, h)
                for v, w, h in [("native", 16, 20), ("runtime", 8, 10)]
                for i in [3, 1, 2, 0]
            }
        )
        importer = Importer([p])
        for name, record in interactable_sequences(p, "metadata.json", data):
            asset = importer.animation(p, "metadata.json", record, name)
            self.assertNotIn("interact", asset["clips"])
            self.assertEqual(asset["clips"]["arm"]["d45"]["durationsMs"], [100, 1000 / 60])
            completion = asset["clips"]["completion"]["d45"]
            self.assertEqual(completion["markers"], [{"id": "complete", "atMs": 200}])
            self.assertEqual(
                completion["frames"][0]["anchor"], [8, 18] if name.endswith("native") else [4, 9]
            )
        self.assertIsNone(interactable_sequences(p, "review.json", data))
        data["segments"] = {"interact": [0, 1, 2, 3]}
        with self.assertRaisesRegex(ValueError, "externally controlled hold"):
            interactable_sequences(p, "metadata.json", data)

    def test_review_inventory_is_not_playback_but_missing_timed_drawings_remain_a_contract(self):
        review = {"frames": [{"file": "a.png", "sha256": "a", "alpha_bbox": [1, 2, 3, 4]}]}
        self.assertFalse(animation_contract(review))
        self.assertFalse(
            animation_contract(
                {
                    "bundle_contains_art": False,
                    "packages": [{"sha256": "a"}],
                    "clips": [{"frames": [{"file": "missing.png", "hold_ticks": 5}]}],
                }
            )
        )
        self.assertTrue(
            animation_contract(
                {
                    "frames": [{"file": "missing.png", "hold_ticks": 5}],
                }
            )
        )

        self.assertTrue(animation_contract({"loop": False, "frames": [{"file": "missing.png"}]}))

    def test_split_exports_require_exact_drawing_hashes_and_keep_runtime_registration(self):
        p = package({})
        p.images_by_hash = {
            "verified": {"group": "runtime", "member": "renamed.png", "canvas": [8, 8]}
        }
        data = {
            "runtime_integration": {"ppu": 145, "common_pivot_xy": [4, 7]},
            "shared_states": {"R0": {"sha256": "verified"}},
            "frames": [{"file": "missing.png", "shared_state_id": "R0", "hold_ticks_60hz": 7}],
        }
        original = json.dumps(data, sort_keys=True)
        normalized = supplied_sequences(p, "source.json", data)
        clip = Importer([p]).animation(p, "source.json", normalized, "hero")["clips"]["animation"][
            "d45"
        ]
        self.assertEqual(
            clip["frames"][0],
            {
                "group": "runtime",
                "member": "renamed.png",
                "canvas": [8, 8],
                "anchor": [4, 7],
                "density": 145,
                "sha256": "verified",
            },
        )
        self.assertEqual(clip["durationsMs"], [7 * 1000 / 60])
        self.assertEqual(json.dumps(data, sort_keys=True), original)
        with self.assertRaisesRegex(ValueError, "missing"):
            Importer([p]).animation(
                p,
                "source.json",
                {
                    **normalized,
                    "frames": [{"file": "missing.png", "sha256": "different", "hold_ticks": 7}],
                },
                "hero",
            )

    def test_indexed_atlas_keeps_supplied_order_durations_and_cell_pivots(self):
        p = package({"runtime/atlas.png": png(16, 8)})
        data = {
            "cell_size": [8, 8],
            "pivot_pixels_top_left": [4, 7],
            "pixels_per_unit": 145,
            "atlas": "atlas.png",
            "atlas_columns": 2,
            "native_cel_count": 2,
            "timing_hz": 60,
            "clips": {"sleep": {"frames": [1, 0, 1], "duration_ticks": [90, 30, 60], "loop": True}},
        }
        normalized = supplied_sequences(p, "runtime/manifest.json", data)
        clip = Importer([p]).animation(p, "runtime/manifest.json", normalized, "cat")["clips"][
            "sleep"
        ]["d45"]
        self.assertEqual(clip["durationsMs"], [1500, 500, 1000])
        self.assertEqual(
            [f["rect"] for f in clip["frames"]], [[8, 0, 8, 8], [0, 0, 8, 8], [8, 0, 8, 8]]
        )
        self.assertTrue(
            all(f["canvas"] == [8, 8] and f["anchor"] == [4, 7] for f in clip["frames"])
        )
        with self.assertRaisesRegex(ValueError, "outside"):
            supplied_sequences(
                p,
                "runtime/manifest.json",
                {
                    **data,
                    "clips": {"sleep": {"frames": [2], "duration_ticks": [60]}},
                },
            )

    def test_timing_variants_and_optional_registration_preserve_each_authored_sequence(self):
        raw = {
            "loop": False,
            "terminal_hold": "indefinite",
            "frames": [
                {"drawing": 1, "file": "a.png", "hold_ticks_60hz": 8},
                {"drawing": 2, "file": "b.png", "hold_indefinitely": True},
            ],
        }
        p = package({"a.png": png(8, 8), "b.png": png(8, 8), "raw.json": json.dumps(raw)})
        optional = {
            "optional": True,
            "recommended_preview_variant": "registered",
            "clip": "raw",
            "pivot_px": [4, 7],
            "frames": [
                {"drawing": 1, "file": "a.png"},
                {"drawing": 2, "file": "b.png"},
            ],
        }
        clip = Importer([p]).animation(
            p,
            "optional.json",
            supplied_sequences(p, "optional.json", optional),
            "variant",
            defaults={"pixels_per_unit": 256},
        )["clips"]["raw"]["d45"]
        self.assertEqual(clip["durationsMs"], [8 * 1000 / 60, 1000 / 60])
        self.assertEqual(clip["endBehavior"], "hold")
        variants = {
            "pivot_px": [4, 7],
            "frames": [{"file": "a.png"}, {"file": "b.png"}],
            "timings": {"slow": {"ticks_60hz": [8, 10]}, "brisk": {"ticks_60hz": [5, 7]}},
        }
        asset = Importer([p]).animation(
            p,
            "timing.json",
            supplied_sequences(p, "timing.json", variants),
            "walk",
            defaults={"pixels_per_unit": 256},
        )
        self.assertEqual(
            asset["clips"]["slow"]["d45"]["durationsMs"], [8 * 1000 / 60, 10 * 1000 / 60]
        )
        self.assertEqual(
            asset["clips"]["brisk"]["d45"]["durationsMs"], [5 * 1000 / 60, 7 * 1000 / 60]
        )
        with self.assertRaisesRegex(ValueError, "exact supplied"):
            supplied_sequences(
                p, "timing.json", {**variants, "timings": {"bad": {"ticks_60hz": [8]}}}
            )

    def test_hero_cursor_and_native_expansion_keep_fixed_registration_and_timing(self):
        for data in [
            {
                "clip_id": "cursor",
                "facing_world_xyz": [0, 0, 1],
                "canvas_px": [8, 8],
                "pivot_top_left_px": [4, 7],
                "pixels_per_unit_approximate": 145,
                "cycle": {"ticks": 40},
                "runtime_frames": [
                    {"file": "frames/0.png", "hold_ticks_60hz": 7},
                    {"file": "frames/1.png", "hold_ticks_60hz": 33},
                ],
            },
            {
                "asset": "pickup",
                "runtime": {
                    "cell_size": [8, 8],
                    "pivot_px_top_left": [4, 7],
                    "suggested_pixels_per_unit": 145,
                    "loop": False,
                },
                "frames": [
                    {"file": "frames/0.png", "hold_ticks_60hz": 7},
                    {"file": "frames/1.png", "hold_ticks_60hz": 33},
                ],
            },
        ]:
            with self.subTest(data=data):
                p = package({"kit/frames/0.png": png(8, 8), "kit/frames/1.png": png(8, 8)})
                p.spec["format"] = "hero-native"
                normalized = supplied_sequences(p, "kit/manifest.json", data)
                asset = Importer([p]).animation(
                    p, "kit/manifest.json", normalized, "hero", kind="character"
                )
                clip = next(iter(asset["clips"].values()))["d45"]
                self.assertEqual(clip["durationsMs"], [7 * 1000 / 60, 33 * 1000 / 60])
                self.assertEqual(clip["loop"], "cycle" in data)
                self.assertFalse(asset["mirroring"])
                for frame in clip["frames"]:
                    self.assertEqual(frame["canvas"], [8, 8])
                    self.assertEqual(frame["anchor"], [4, 7])
                    self.assertEqual(frame["density"], 145)

    def test_interaction_exports_preserve_registration_event_and_persistent_states(self):
        for schema in ("lantern-knight.sprite-clip.v1", "lantern_knight.sprite_animation.v1"):
            for standalone in (True, False):
                with self.subTest(schema=schema, standalone=standalone):
                    files = {"kit/atlas.png": png(16, 8)}
                    if standalone:
                        files.update(
                            {
                                "kit/frames/0.png": png(8, 8),
                                "kit/frames/1.png": png(8, 8),
                                "kit/states/empty.png": png(8, 8),
                            }
                        )
                    p = package(files)
                    data = {
                        "schema": schema,
                        "animation": "open",
                        "canvas": {"width": 8, "height": 8},
                        "pivot_px": {"x": 4, "y": 7, "origin": "top_left"},
                        "atlas": {"file": "atlas.png"},
                        "import": {"pixels_per_unit": 100},
                        "loop": False,
                        "frames": [
                            {
                                "file": "frames/0.png",
                                "rect": {"x": 0, "y": 0, "w": 8, "h": 8},
                                "duration_ms": 100,
                            },
                            {
                                "file": "frames/1.png",
                                "rect": {"x": 8, "y": 0, "w": 8, "h": 8},
                                "duration_ms": 160,
                            },
                        ],
                        "events": [{"name": "loot_release", "frame": 1, "time_ms": 100}],
                        "states": {"empty": "states/empty.png"},
                    }
                    if schema.endswith("sprite_animation.v1"):
                        del data["canvas"]
                        del data["import"]
                        data.update(cell_size_px=[8, 8], pivot_px=[4, 7], atlas="atlas.png")
                        data["states"] = {"empty": {"file": "states/empty.png", "persistent": True}}
                    original = json.dumps(data, sort_keys=True)
                    normalized = supplied_sequences(p, "kit/animation.json", data)
                    asset = Importer([p]).animation(
                        p,
                        "kit/animation.json",
                        normalized,
                        "container",
                        defaults={"pixels_per_unit": 256},
                    )
                    clip = asset["clips"]["open"]["d45"]
                    self.assertEqual(clip["durationsMs"], [100, 160])
                    self.assertEqual(clip["markers"], [{"id": "loot_release", "atMs": 100}])
                    self.assertFalse(clip["loop"])
                    self.assertEqual(clip["endBehavior"], "hold")
                    self.assertEqual(clip["frames"][1]["anchor"], [4, 7])
                    self.assertEqual(clip["frames"][1]["density"], 100 if "import" in data else 256)
                    self.assertEqual(clip["frames"][1]["canvas"], [8, 8])
                    if standalone:
                        self.assertEqual(clip["frames"][1]["member"], "kit/frames/1.png")
                        self.assertNotIn("rect", clip["frames"][1])
                    else:
                        self.assertEqual(clip["frames"][1]["member"], "kit/atlas.png")
                        self.assertEqual(clip["frames"][1]["rect"], [8, 0, 8, 8])
                    if standalone:
                        self.assertEqual(
                            asset["clips"]["empty"]["d45"]["frames"][0]["member"],
                            "kit/states/empty.png",
                        )
                    else:
                        self.assertNotIn("empty", asset["clips"])
                    self.assertEqual(json.dumps(data, sort_keys=True), original)

    def test_existing_named_clip_schema_keeps_its_original_adapter(self):
        data = {
            "schema": "lantern-knight.sprite-clip.v1",
            "clip": "move",
            "canvas": [8, 8],
            "pivot_px": [4, 7],
            "frames": [{"file": "frame.png", "duration_ms": 100}],
        }
        p = package({"frame.png": png(8, 8)})
        asset = Importer([p]).animation(
            p,
            "clip.json",
            supplied_sequences(p, "clip.json", data),
            "actor",
            defaults={"pixels_per_unit": 256},
        )
        self.assertEqual(asset["clips"]["move"]["d45"]["durationsMs"], [100])

    def test_loot_sequences_keep_baked_motion_fixed_pivot_contact_and_terminal_hold(self):
        p = package(
            {
                f"loot/runtime/{name}.png": png(8, 8)
                for name in ["drop0", "drop1", "idle0", "idle1", "rest"]
            }
        )
        data = {
            "canvas": [8, 8],
            "pivot_px": [4, 7],
            "rest": {"file": "rest.png", "persistent": True},
            "drop": {
                "loop": False,
                "terminal": "Hold last sprite. Do not clear or hide the item.",
                "events": [{"name": "first_ground_contact", "tick": 2}],
                "frames": [
                    {
                        "file": "drop0.png",
                        "duration_ticks": 2,
                        "ground_anchor_on_canvas_px": [1, 1],
                    },
                    {"file": "drop1.png", "duration_ticks": 3},
                ],
            },
            "idle": {
                "loop": True,
                "frames": [
                    {"file": "idle0.png", "duration_ms": 40},
                    {"file": "idle1.png", "duration_ms": 80},
                ],
            },
        }
        original = json.dumps(data, sort_keys=True)
        normalized = supplied_sequences(p, "loot/runtime/animation.json", data)
        asset = Importer([p]).animation(
            p, "loot/runtime/animation.json", normalized, "loot", defaults={"pixels_per_unit": 256}
        )
        drop = asset["clips"]["drop"]["d45"]
        self.assertEqual(drop["durationsMs"], [2 * 1000 / 60, 3 * 1000 / 60])
        self.assertEqual(drop["frames"][0]["anchor"], [4, 7])
        self.assertEqual(drop["frames"][0]["member"], "loot/runtime/drop0.png")
        self.assertEqual(drop["endBehavior"], "hold")
        self.assertFalse(drop["loop"])
        self.assertEqual(drop["markers"], [{"id": "first_ground_contact", "atMs": 2 * 1000 / 60}])
        self.assertTrue(asset["clips"]["idle"]["d45"]["loop"])
        self.assertEqual(asset["clips"]["idle"]["d45"]["durationsMs"], [40, 80])
        self.assertEqual(
            asset["clips"]["rest"]["d45"]["frames"][0]["member"], "loot/runtime/rest.png"
        )
        self.assertEqual(json.dumps(data, sort_keys=True), original)

    def test_loose_loot_atlas_exports_use_verified_sibling_identities_and_local_rectangles(self):
        data = {
            "canvas": [8, 8],
            "pivot_px": [4, 7],
            "rest": {"file": "rest.png"},
            "drop": {
                "loop": False,
                "atlas": {"file": "atlas.png"},
                "frames": [
                    {"file": "absent/drop0.png", "atlas_rect": [8, 0, 8, 8], "duration_ticks": 3}
                ],
            },
            "idle": {
                "loop": True,
                "atlas": {"file": "atlas.png"},
                "frames": [{"atlas_rect": [0, 0, 8, 8], "duration_ticks": 6}],
            },
        }
        records = [
            {"path": "icons/item/" + name, "sha256": name, "kind": "source"}
            for name in ["animation.json", "atlas.png", "rest.png"]
        ]
        records.append({"path": "icons/other/atlas.png", "sha256": "outside", "kind": "source"})
        locators = {r["sha256"]: ("fixture", r["sha256"]) for r in records}
        values = {
            "file:fixture/animation.json": json.dumps(data).encode(),
            "file:fixture/atlas.png": png(16, 8),
            "file:fixture/rest.png": png(8, 8),
        }

        class Reader:
            def read(self, ref):
                return values[ref]

        p = LoosePackage(records[0], records, locators, Reader())
        normalized = supplied_sequences(p, records[0]["path"], p.json(records[0]["path"]))
        asset = Importer([]).animation(
            p, records[0]["path"], normalized, "icon", defaults={"pixels_per_unit": 256}
        )
        frame = asset["clips"]["drop"]["d45"]["frames"][0]
        self.assertEqual(frame["group"], "fixture")
        self.assertEqual(frame["member"], "atlas.png")
        self.assertEqual(frame["rect"], [8, 0, 8, 8])
        self.assertEqual(frame["canvas"], [8, 8])
        self.assertEqual(frame["anchor"], [4, 7])
        self.assertEqual(frame["trim"], [0, 0, 8, 8])
        self.assertNotIn("icons/other/atlas.png", p.names)
        with self.assertRaises(ValueError):
            p.reference("../other/atlas.png", "icons/item")

    def test_numbered_fire_preserves_order_holds_pivot_and_off_state_without_atlas_offsets(self):
        for filename in ["frame_00.png", "frame-00.png", "00.png"]:
            with self.subTest(filename=filename):
                second = filename.replace("00", "01")
                p = package(
                    {
                        "fire/frames/" + filename: png(8, 8),
                        "fire/frames/" + second: png(8, 8),
                        "fire/unlit.png": png(8, 8),
                    }
                )
                data = {
                    "runtime_size": [8, 8],
                    "pivot_px": [4, 7],
                    "loop_ticks": 15,
                    "frames": [
                        {"frame": 1, "rect": [8, 8, 8, 8], "hold_60hz": 9},
                        {"frame": 0, "rect": [24, 8, 8, 8], "hold_60hz": 6},
                    ],
                }
                normalized = supplied_sequences(p, "fire/metadata.json", data)
                asset = Importer([p]).animation(
                    p, "fire/metadata.json", normalized, "fire", defaults={"pixels_per_unit": 256}
                )
                clip = asset["clips"]["loop"]["d45"]
                self.assertTrue(clip["loop"])
                self.assertEqual(clip["durationsMs"], [150, 100])
                self.assertEqual(clip["frames"][0]["member"], "fire/frames/" + second)
                self.assertEqual(clip["frames"][0]["anchor"], [4, 7])
                self.assertNotIn("rect", clip["frames"][0])
                self.assertEqual(
                    asset["clips"]["unlit"]["d45"]["frames"][0]["member"], "fire/unlit.png"
                )
                data["frames"].pop()
                with self.assertRaisesRegex(ValueError, "timing does not cover exact"):
                    supplied_sequences(p, "fire/metadata.json", data)

    def test_numbered_fire_normalized_pivot_uses_native_frame_dimensions(self):
        p = package({"frames/frame_00.png": png(16, 16), "frames/frame_01.png": png(16, 16)})
        data = {
            "frame_size": [16, 16],
            "pivot_normalized": [0.5, 0.875],
            "composite_order": ["illumination", "rear", "front"],
            "frames": [{"index": 0, "hold_ticks": 7}, {"index": 1, "hold_ticks": 7}],
        }
        asset = Importer([p]).animation(
            p,
            "metadata.json",
            supplied_sequences(p, "metadata.json", data),
            "native-fire",
            defaults={"pixels_per_unit": 256},
        )
        clip = asset["clips"]["loop"]["d45"]
        self.assertEqual(clip["frames"][0]["anchor"], [8, 14])
        self.assertTrue(clip["loop"])
        self.assertEqual(clip["durationsMs"], [7 * 1000 / 60] * 2)

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
        self.assertEqual(clip["markers"][0]["atMs"], 466.66666666666663)
        self.assertEqual(clip["durationsMs"], durations)
        with self.assertRaisesRegex(ValueError, "event outside supplied timeline"):
            importer.clip(
                asset,
                "invalid",
                "d45",
                [{}] * 6,
                durations,
                markers=[{**marker, "atMs": marker["atMs"] + 0.001}],
            )

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
