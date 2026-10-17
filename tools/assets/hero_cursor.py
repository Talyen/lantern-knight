"""Import the exact supplied facing/travel matrix; never infer or mirror a view."""

import hashlib
import math
import struct

from source import read

HEADINGS = {
    "DL": "d00",
    "D": "d45",
    "DR": "d90",
    "R": "d135",
    "UR": "d180",
    "U": "d225",
    "UL": "d270",
    "L": "d315",
}


def extend(root, index, resolver, frames, clips, authored):
    import json

    selection = json.loads(read(root, index, "hero-cursor", "selection.json", resolver))
    entries = selection["clips"]
    pairs = {(c["facing"], c["travel"]) for c in entries}
    if len(entries) != 64 or pairs != {(f, t) for f in HEADINGS for t in HEADINGS}:
        raise ValueError("Hero cursor locomotion requires exactly 64 facing/travel pairs")

    def drawing(group, member, fid, expected, canvas, pivot, density):
        data = read(root, index, group, member, resolver)
        digest = hashlib.sha256(data).hexdigest()
        if (
            digest != expected
            or data[:8] != b"\x89PNG\r\n\x1a\n"
            or struct.unpack(">IIBB", data[16:26]) != (*canvas, 8, 6)
        ):
            raise ValueError("Hero cursor drawing differs: " + fid)
        frames.append(
            {
                "id": fid,
                "group": group,
                "member": member,
                "sha256": digest,
                "registration": {"canvas": canvas, "anchor": pivot, "density": density},
            }
        )
        return fid

    by_clip = {(c["id"], c["heading"]): c for c in clips}
    by_frame = {f["id"]: f for f in frames}
    for c in entries:
        facing, travel = HEADINGS[c["facing"]], HEADINGS[c["travel"]]
        for label, vector in [("facing", c["facing_world_xyz"]), ("travel", c["travel_world_xyz"])]:
            expected = HEADINGS[c[label]]
            angle = math.atan2(vector[0], vector[2]) % (math.pi * 2)
            if abs(angle - int(expected[1:]) * math.pi / 180) > 1e-8:
                raise ValueError("Hero screen/world direction differs")
        if c["cycle"]["ticks"] != 40 or c["cycle"]["hz"] != 60:
            raise ValueError("Hero cursor locomotion must retain its 40-tick cycle")
        if facing == travel:
            forward = by_clip["walk", facing]
            records = [by_frame[fid] for fid in forward["frames"]]
            package = next(
                p for p in c["packages"] if p["kind"] in ("runtime_or_combined", "original_runtime")
            )
            if (
                index["archives"][index["archiveGroups"][records[0]["group"]]]["sha256"]
                != package["sha256"]
                or [f["sha256"] for f in records] != [f["sha256"] for f in c["frames"]]
                or forward["durationsMs"] != [f["hold_ticks_60hz"] * 1000 / 60 for f in c["frames"]]
                or any(
                    f["registration"]
                    != {
                        "canvas": c["canvas_px"],
                        "anchor": c["pivot_top_left_px"],
                        "density": c["pixels_per_unit_approximate"],
                    }
                    for f in records
                )
            ):
                raise ValueError("Existing forward run differs from cursor selection index")
            clip = {**forward, "id": "travel_" + travel}
        else:
            package = c["package"]
            archive = index["archives"][package["filename"]]
            if archive["sha256"] != package["sha256"]:
                raise ValueError("Hero cursor package differs: " + c["clip_id"])
            group = "hero-cursor-" + package["filename"][:-4]
            ids, holds, tick = [], [], 0
            for i, f in enumerate(c["frames"]):
                if f["start_tick"] != tick or f["hold_ticks_60hz"] <= 0:
                    raise ValueError("Hero cursor frame timing differs")
                tick += f["hold_ticks_60hz"]
                ids.append(
                    drawing(
                        group,
                        c["archive_top_folder"] + "/" + f["file"],
                        f"travel_{travel}-{facing}-{i:02}",
                        f["sha256"],
                        c["canvas_px"],
                        c["pivot_top_left_px"],
                        c["pixels_per_unit_approximate"],
                    )
                )
                holds.append(f["hold_ticks_60hz"] * 1000 / 60)
            if tick != 40:
                raise ValueError("Incomplete hero cursor cycle")
            clip = {
                "id": "travel_" + travel,
                "heading": facing,
                "frames": ids,
                "durationsMs": holds,
                "loop": True,
                "notifies": [],
            }
        clips.append(clip)
        authored.setdefault(clip["id"], {})[facing] = {"holdsMs": clip["durationsMs"]}
    for direction in ["U", "D", "L", "R"]:
        c = json.loads(read(root, index, "hero-cursor", "idle-" + direction + ".json", resolver))
        facing = HEADINGS[direction]
        ids = [
            drawing(
                "hero-idle-" + direction,
                f["file"],
                f"idle-{facing}-{i:02}",
                f["sha256"],
                c["runtime_canvas_px"],
                c["pivot_top_left_px"],
                c["pixels_per_unit_approximate"],
            )
            for i, f in enumerate(c["frames"])
        ]
        holds = [f["hold_ticks_60hz"] * 1000 / 60 for f in c["frames"]]
        clips.append(
            {
                "id": "idle",
                "heading": facing,
                "frames": ids,
                "durationsMs": holds,
                "loop": True,
                "notifies": [],
            }
        )
        authored["idle"][facing] = {"holdsMs": holds}
