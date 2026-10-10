"""Normalize explicitly selected world-library metadata without changing source art.

Expanded records belong to the external preparation workspace, never Git. Unknown
registration fails; provisional stills use a documented common reference density.
"""

import argparse
import json
import pathlib
import re
import struct
import zipfile
from contextlib import ExitStack
from resolver import PROJECT, SourceResolver, load_index, safe_relative

HEADINGS = {"DR": "d90", "DL": "d00", "UL": "d270", "UR": "d180"}


def slug(value):
    return re.sub(r"[^a-z0-9_-]+", "-", str(value).lower()).strip("-")


def pick(contexts, *keys, default=None):
    for context in contexts:
        if not isinstance(context, dict):
            continue
        for key in keys:
            v = context.get(key)
            if v is not None:
                return v
    return default


def density_of(contexts, default=256):
    keys = (
        "native_pixels_per_unit",
        "pixels_per_unit",
        "estimated_pixels_per_unit",
        "estimated_ppu",
        "suggested_pixels_per_unit",
        "suggestedPixelsPerUnit",
        "clip_pixels_per_metre",
        "source_density_px_per_m",
        "source_texels_per_metre",
        "world_density_px_per_metre",
        "render_density_px_per_m",
        "recommended_pixels_per_unit",
        "density",
    )
    for context in contexts:
        for key in keys:
            value = context.get(key) if isinstance(context, dict) else None
            if isinstance(value, (int, float)) and value > 0:
                return value
    return default


class Package:
    def __init__(self, spec, archive):
        self.spec, self.zip = spec, archive
        self.names = set(archive.namelist())
        if len(self.names) != len(archive.namelist()):
            raise ValueError("Duplicate archive member: " + spec["archive"])
        self.cache = {}

    def locate(self, name, base=""):
        safe_relative(name)
        for candidate in [name, str(pathlib.PurePosixPath(base) / name)]:
            if candidate in self.names:
                return candidate
        found = [n for n in self.names if n.endswith("/" + name)]
        if len(found) != 1:
            # Export metadata sometimes retains the pre-package path. A unique
            # published filename is safe only inside this verified archive.
            found = [n for n in self.names if n.endswith("/" + pathlib.PurePosixPath(name).name)]
        if len(found) != 1:
            raise ValueError(f"{self.spec['archive']}: ambiguous/missing {name} from {base}")
        return found[0]

    def json(self, name):
        if name not in self.cache:
            owner = (
                self
                if name in self.zip.namelist()
                else next(peer for peer in self.peers if name in peer.zip.namelist())
            )
            self.cache[name] = json.loads(owner.zip.read(name))
        return self.cache[name]

    def dimensions(self, name):
        with self.zip.open(name) as f:
            b = f.read(24)
        if b[:8] != b"\x89PNG\r\n\x1a\n":
            raise ValueError("Expected native PNG: " + name)
        return list(struct.unpack(">II", b[16:24]))

    def reference(self, name, base="", **fields):
        exact = str(pathlib.PurePosixPath(base) / name)
        if exact not in self.names and name not in self.names:
            candidates = [peer for peer in getattr(self, "peers", []) if exact in peer.names]
            if len(candidates) == 1:
                return {"group": candidates[0].spec["group"], "member": exact, **fields}
        try:
            member = self.locate(name, base)
        except ValueError:
            candidates = []
            for peer in getattr(self, "peers", []):
                exact = str(pathlib.PurePosixPath(base) / name)
                if exact in peer.names:
                    candidates.append((peer, exact))
            if len(candidates) != 1:
                raise
            peer, member = candidates[0]
            return {"group": peer.spec["group"], "member": member, **fields}
        return {"group": self.spec["group"], "member": member, **fields}


class Importer:
    def __init__(self, packages):
        self.packages = packages
        self.by_name = {p.spec["archive"]: p for p in packages}
        self.assets = {}
        self.dispositions = []

    def asset(self, identity, label, kind, projection="painted-cutout", placement=None):
        if kind == "effect" and projection == "painted-cutout":
            projection = "projected-world"
        identity = "library-" + slug(identity)
        old = self.assets.get(identity)
        if old:
            if old["type"] != kind:
                raise ValueError("Conflicting logical asset: " + identity)
            return old
        asset = {
            "id": identity,
            "label": label,
            "type": kind,
            "projection": projection,
            "placement": placement
            or (
                "reference"
                if projection == "front-view"
                else "ground"
                if projection == "top-down"
                else "upright"
            ),
            "category": "reference"
            if projection == "front-view"
            else "character"
            if kind == "character"
            else "effect"
            if kind == "effect"
            else "ground"
            if projection == "top-down"
            else "scenery",
            "clips": {},
            "limitations": [
                "Supplied TEST/study artwork; projection and world-size registration are provisional."
            ],
        }
        self.assets[identity] = asset
        return asset

    def clip(self, asset, name, heading, frames, durations, loop=False, end="hold", markers=None):
        name = slug(name)
        if (
            not frames
            or len(frames) != len(durations)
            or any(not isinstance(d, (int, float)) or d <= 0 for d in durations)
        ):
            raise ValueError(f"{asset['id']}/{name}: missing frames or positive timing")
        c = {
            "frames": frames,
            "durationsMs": durations,
            "loop": bool(loop),
            "endBehavior": end,
            "markers": markers or [],
        }
        dirs = asset["clips"].setdefault(name, {})
        if heading in dirs and dirs[heading] != c:
            raise ValueError(f"Conflicting current clip: {asset['id']}/{name}/{heading}")
        dirs[heading] = c

    def frame(self, p, record, contexts, base="", density=None, anchor=None):
        contexts = [record, *contexts]
        name = pick(
            [record],
            "runtime_archive_member",
            "file",
            "png",
            "sprite",
            "path",
            "image",
            "revised_image",
        )
        if not isinstance(name, str):
            raise ValueError("Missing frame filename: " + str(record)[:160])
        ref = p.reference(name, base)
        dims = p.dimensions(ref["member"])
        canvas = pick(
            contexts,
            "canvas_px",
            "cell_px",
            "cell_size",
            "native_cell_size",
            "canvas_pixels",
            "canvas",
            "frame_dimensions",
            "source_canvas",
            "runtimeCanvasPx",
            "runtime_canvas",
            "frame_canvas",
            default=dims,
        )
        if isinstance(canvas, dict):
            canvas = [canvas.get("width"), canvas.get("height")]
        pivot = anchor or pick(
            contexts,
            "pivot_pixels_top_left",
            "pivot_top_left_px",
            "pivot_px_top_left",
            "pivot_pixels",
            "root_origin_pixels",
            "root_pixels",
            "root_px_top_left",
            "fixed_root_pixels",
            "fixed_pivot_top_left_px",
            "pivot_top_left",
            "pivot_px",
            "pivotPx",
            "ground_pivot_px",
            "fixed_pivot_pixels_top_left",
            "pivotPixels",
            "default_root",
            "anchor_pixels",
            "anchor",
            "pivot",
            "root",
        )
        if isinstance(pivot, dict):
            pivot = pick(
                [pivot],
                "top_left_px",
                "pixels_top_left",
                "pixel_top_left",
                "pixels",
                default=pick([contexts[-1]], "pivot_px"),
            )
        ppu = density or pick(
            contexts,
            "pixels_per_unit",
            "native_pixels_per_unit",
            "estimated_pixels_per_unit",
            "estimated_ppu",
            "recommended_pixels_per_unit",
            "source_density_px_per_m",
            "source_texels_per_metre",
            "world_density_px_per_metre",
            "render_density_px_per_m",
            "density",
        )
        if pivot is None or not isinstance(ppu, (int, float)):
            raise ValueError(f"{p.spec['archive']}/{ref['member']}: unresolved pivot/density")
        if list(canvas) != dims and "rect" not in record:
            # Supplied mixed-frame registration is authoritative; a common canvas
            # must never force standalone drawings into the wrong dimensions.
            canvas = dims
        return {
            **ref,
            "canvas": canvas,
            "anchor": list(pivot),
            "density": ppu,
            **({k: record[k] for k in ["rect", "trim"] if k in record}),
            **({"sha256": record["sha256"]} if record.get("sha256") else {}),
        }

    def still(
        self, p, record, contexts, base, kind="prop", projection="painted-cutout", identity=None
    ):
        name = pick(
            [record],
            "asset_id",
            "id",
            "old_id",
            default=pathlib.PurePosixPath(
                pick([record], "png", "file", "path", "revised_image", "image")
            ).stem,
        )
        if "library-" + slug(identity or name) in self.assets:
            return self.assets["library-" + slug(identity or name)]
        asset = self.asset(
            identity or name, record.get("name", str(name).replace("_", " ")), kind, projection
        )
        filename = pick([record], "png", "file", "path", "revised_image", "image")
        member = p.locate(filename, base)
        dims = p.dimensions(member)
        pivot = pick(
            [record, *contexts],
            "ground_pivot_px",
            "pivot_pixels",
            "pivot_px",
            "anchor_pixels",
            "pivot",
        )
        if pivot is None and record.get("pivot_normalized"):
            pivot = [v * dims[i] for i, v in enumerate(record["pivot_normalized"])]
        bbox = pick(
            [record],
            "alpha_bounds_ge128",
            "visible_alpha_bbox_threshold_16",
            "alpha_bounds_px",
            "paint_bounds_pixels",
            default=[0, 0, *dims],
        )
        if not isinstance(bbox, list):
            bbox = [0, 0, *dims]
        pivot = pivot or (
            [dims[0] / 2, dims[1] / 2]
            if projection in ("top-down", "front-view")
            else [(bbox[0] + bbox[2]) / 2, min(dims[1], bbox[3])]
        )
        density = pick(
            [record, *contexts],
            "source_density_px_per_m",
            "source_texels_per_metre",
            "pixels_per_unit",
            default=256,
        )
        f = self.frame(p, {**record, "file": member}, [], density=density, anchor=pivot)
        self.clip(asset, "still", "d45", [f], [1000], True)
        return asset

    def static_pack(self, p, member, data):
        base = str(pathlib.PurePosixPath(member).parent)
        records = data if isinstance(data, list) else data.get("assets", [])
        original_name = base + "/original_manifest.json"
        originals = p.json(original_name).get("assets", []) if original_name in p.names else []
        originals = {a["id"]: a for a in originals}
        for record in records:
            record = {**originals.get(record.get("asset_id"), {}), **record}
            if not any(k in record for k in ["png", "file", "path", "revised_image", "image"]):
                continue
            projection = (
                "front-view"
                if "Wall_Dressing" in member
                else "top-down"
                if any(
                    s in member for s in ["Floor_Features", "Ground_Surfaces", "Ground_Transitions"]
                )
                else "painted-cutout"
            )
            kind = (
                "character"
                if p.spec["category"] in (2, 7)
                else "material"
                if "/materials/" in record.get("png", "")
                else "prop"
            )
            asset = self.still(p, record, [data], base, kind, projection)
            if p.spec["category"] == 6:
                asset["category"] = "pickup"

    def animation(
        self, p, member, data, identity, label=None, kind="prop", heading="d45", defaults=None
    ):
        base = str(pathlib.PurePosixPath(member).parent)
        defaults = defaults or {}
        asset = self.asset(identity, label or identity, kind)
        asset["mirroring"] = False if kind == "character" else True
        clips = data.get("clips", data.get("actions"))
        if clips is None and "frames" in data:
            clips = {data.get("id", data.get("clip", "animation")): data}
        if isinstance(clips, list):
            clips = {c["id"]: c for c in clips}
        if not isinstance(clips, dict):
            raise ValueError("Unsupported clip metadata: " + member)
        for name, c in clips.items():
            if not isinstance(c, dict):
                continue
            contexts = [c, data, defaults]
            if c.get("space") == "top_down":
                asset["projection"] = "top-down"
                asset["placement"] = "ground"
            fs = c.get("frames", c.get("cels", c.get("drawings")))
            if fs is None and c.get("rects") and c.get("atlas"):
                fs = [
                    {
                        "file": c["atlas"],
                        "rect": [r["x"], r["y"], r["w"], r["h"]],
                        "trim": [0, 0, r["w"], r["h"]],
                    }
                    for r in c["rects"]
                ]
            if fs is None and c.get("timeline") and c.get("unique_cels"):
                fs = sorted(
                    n for n in p.names if "/frames/" + name + "/" in n and n.endswith(".png")
                )
                if len(fs) != c["unique_cels"]:
                    raise ValueError("Incomplete numbered cels: " + member + "/" + name)
            if not isinstance(fs, list):
                raise ValueError(f"{member}/{name}: no explicit frame list")
            records = [{"file": f} if isinstance(f, str) else f for f in fs]
            holds = pick(
                contexts,
                "holds_60hz",
                "holds_ticks",
                "hold_ticks",
                "hold_ticks_in_order",
                "frame_hold_ticks",
                "duration_ticks",
                "durations_ticks_60hz",
            )
            timeline = c.get("timeline")
            if timeline and all("cel" in t for t in timeline):
                # Index origin follows the supplied first cel index; no sorting.
                offset = 1 if min(t["cel"] for t in timeline) == 1 else 0
                records = [records[t["cel"] - offset] for t in timeline]
                holds = [t["hold_ticks"] for t in timeline]
            frames, times = [], []
            for i, f in enumerate(records):
                duration = pick([f], "duration_ms", default=None)
                if duration is None:
                    duration = pick([f], "duration_seconds", "durationSeconds", default=None)
                    if duration is not None:
                        duration *= 1000
                if duration is None:
                    h = pick(
                        [f],
                        "hold_ticks_60hz",
                        "hold_ticks",
                        "duration_ticks",
                        "durationTicks",
                        "hold_ticks_60",
                        "ticks",
                        "ticks_60hz",
                        default=holds[i] if isinstance(holds, list) else None,
                    )
                    if h is None and (
                        f.get("hold_indefinitely")
                        or f.get("terminal_hold")
                        or f.get("terminal")
                        or c.get("terminal_hold") == "indefinite"
                    ):
                        h = 1
                    if h is not None:
                        duration = (
                            h
                            * 1000
                            / pick(
                                contexts,
                                "tick_rate_hz",
                                "tick_rate",
                                "tick_hz",
                                "clock_hz",
                                "timebase_hz",
                                default=60,
                            )
                        )
                if duration is None:
                    fps = pick(contexts, "fps", "source_fps", "sourceFPS")
                    if fps:
                        duration = 1000 / fps
                if f.get("terminal_hold") and (duration is None or duration == 0):
                    duration = 1000 / 60
                density = pick([f], "ppu_relative_v02", default=1) * density_of(contexts)
                frames.append(self.frame(p, f, contexts, base, density=density))
                times.append(duration)
            end = (
                "hide"
                if any(
                    t
                    in str(
                        pick(
                            contexts,
                            "endBehavior",
                            "finishBehavior",
                            "end_behavior",
                            "terminal",
                            "completion",
                            default="",
                        )
                    ).lower()
                    for t in ["remove", "disable_renderer", "hide", "clear"]
                )
                else "hold"
            )
            events = c.get("events", {})
            markers = (
                [
                    {"id": str(k), "atMs": v * 1000 / 60}
                    for k, v in events.items()
                    if isinstance(v, (int, float))
                ]
                if isinstance(events, dict)
                else [
                    {
                        "id": str(e.get("id", e.get("event", "visual"))),
                        "atMs": e["tick"] * 1000 / 60,
                    }
                    for e in events
                    if isinstance(e, dict) and isinstance(e.get("tick"), (int, float))
                ]
            )
            tick = pick([c], "visual_event_tick", "attack_visual_event_tick")
            if isinstance(tick, (int, float)):
                markers.append({"id": "visual_attack", "atMs": tick * 1000 / 60})
            asset["layer"] = (
                "below-actor"
                if "below" in str(c.get("layer", "")) or "behind" in str(c.get("layer", ""))
                else "overlay"
                if c.get("layer") == "above_actor"
                else "world"
            )
            self.clip(
                asset,
                name,
                heading,
                frames,
                times,
                c.get("loop", c.get("mode") == "loop" or data.get("loop", False)),
                end,
                markers,
            )
        return asset

    def package(self, p):
        if p.spec.get("format"):
            self.delivered_package(p)
            return
        manifests = sorted(
            n
            for n in p.names
            if n.endswith(("/manifest.json", "/pack_manifest.json", "/animation.json"))
            or n in ("manifest.json",)
        )
        animation_members = sorted(n for n in p.names if n.endswith("/animation/clips.json"))
        imported = 0
        if p.spec["category"] == 2:
            asset = self.asset(
                slug(p.spec["archive"].split("_Ink_")[0]),
                p.spec["archive"].split("_Ink_")[0].replace("_", " "),
                "character",
            )
            asset["mirroring"] = False
            for member in sorted(p.names):
                if "/atlases/" not in member or not member.endswith(".json"):
                    continue
                meta = p.json(member)
                if not meta.get("rects"):
                    continue
                name = pathlib.PurePosixPath(member).stem.split("_384")[0]
                image = p.reference(
                    meta.get("image", meta.get("texture")),
                    str(pathlib.PurePosixPath(member).parent),
                )
                frames = [
                    {
                        **image,
                        "canvas": [r["rect"][2], r["rect"][3]],
                        "anchor": r["pivot_px"],
                        "density": 256,
                        "rect": r["rect"],
                        "trim": [0, 0, r["rect"][2], r["rect"][3]],
                    }
                    for r in meta["rects"]
                ]
                loop = name not in ["mandible_attack", "recoil"]
                self.clip(
                    asset,
                    name,
                    "d45",
                    frames,
                    [
                        r.get("duration_seconds", 1 / meta["source_fps"]) * 1000
                        for r in meta["rects"]
                    ],
                    loop,
                )
            if not asset["clips"]:
                raise ValueError("Missing enemy-study atlas metadata")
            return
        for member in manifests:
            if any(
                s in member.lower() for s in ["/source/", "/proof", "/review", "/qa", "/metadata/"]
            ):
                continue
            data = p.json(member)
            if (
                isinstance(data, dict)
                and isinstance(data.get("frames"), dict)
                and data.get("animations")
            ):
                base = str(pathlib.PurePosixPath(member).parent)
                for name, f in data["frames"].items():
                    if not f.get("persistent"):
                        continue
                    asset = self.asset(name, name.replace("_", " "), "prop")
                    asset["category"] = "pickup"
                    frame = self.frame(p, f, [{"canvas": [256, 256]}], base, density=256)
                    self.clip(asset, "still", "d45", [frame], [1000], True)
                for name, c in data["animations"].items():
                    fs = [f for key, f in data["frames"].items() if key.startswith(name + "_")]
                    asset = self.animation(
                        p,
                        member,
                        {
                            "clips": {name: {**c, "frames": fs}},
                            "canvas": [256, 256],
                            "pixels_per_unit": 256,
                        },
                        name,
                        kind="effect",
                    )
                    if c.get("terminal", {}).get("action") == "disable_renderer":
                        asset["clips"][name]["d45"]["endBehavior"] = "hide"
                imported += 1
                continue
            if isinstance(data, dict) and data.get("npcs"):
                base = str(pathlib.PurePosixPath(member).parent)
                for name, npc in data["npcs"].items():
                    asset = self.asset(name, name.replace("_", " "), "character")
                    asset["mirroring"] = False
                    ref = p.reference(npc["atlas"], base)
                    w, h = npc["cell_size"]
                    columns = npc["columns"]
                    for action in ["work", "talk_ready"]:
                        c = npc[action]
                        fs = [
                            {
                                **ref,
                                "canvas": [w, h],
                                "anchor": npc["pivot_pixels_top_left"],
                                "density": data["pixels_per_unit"],
                                "rect": [(i % columns) * w, (i // columns) * h, w, h],
                                "trim": [0, 0, w, h],
                            }
                            for i in c["frames"]
                        ]
                        self.clip(
                            asset,
                            action,
                            "d45",
                            fs,
                            [t * 1000 / 60 for t in c["duration_ticks"]],
                            c["loop"],
                        )
                imported += 1
                continue
            if isinstance(data, dict) and data.get("source_assets"):
                layout_member = str(pathlib.PurePosixPath(member).parent) + "/scene_layout.json"
                layout = p.json(layout_member)
                base = str(pathlib.PurePosixPath(member).parent)
                for rec in layout["assets"]:
                    card = next((c for c in layout["cards"] if c["asset"] == rec["id"]), {})
                    projection = (
                        "top-down"
                        if rec.get("source_view") == "top_down_material"
                        else "painted-cutout"
                    )
                    self.still(
                        p,
                        {
                            **rec,
                            "pivot": card.get("pivot_px"),
                            "source_texels_per_metre": card.get(
                                "source_density_pixels_per_projected_metre", 256
                            ),
                        },
                        [],
                        base,
                        "material" if projection == "top-down" else "prop",
                        projection,
                    )
                imported += 1
                continue
            if isinstance(data, dict) and data.get("images"):
                # Whole location/backdrop paintings are browse-only references.
                base = str(pathlib.PurePosixPath(member).parent)
                records = data["images"]
                for rec in records:
                    if isinstance(rec, str):
                        rec = {"file": rec, "id": pathlib.PurePosixPath(rec).stem}
                    asset = self.still(p, rec, [], base)
                    asset["placement"] = "reference"
                    asset["category"] = "reference"
                imported += 1
                continue
            if isinstance(data, list):
                self.static_pack(p, member, data)
                imported += 1
                continue
            if "states" in str(data.get("assets", [])[:1]):
                base = str(pathlib.PurePosixPath(member).parent)
                for a in data["assets"]:
                    asset = self.asset(a["id"], a["id"].replace("_", " "), "prop")
                    for state, rec in a["states"].items():
                        f = self.frame(p, rec, [a, data], base)
                        self.clip(asset, state, "d45", [f], [1000], True)
                imported += 1
            elif data.get("assets"):
                self.static_pack(p, member, data)
                imported += 1
            elif data.get("frames") and isinstance(data["frames"], list):
                # Trimmed scenic atlases retain explicit original-canvas placement.
                if data["frames"][0].get("atlas") and data["frames"][0].get("source_rect"):
                    asset = self.asset(data["id"], data["id"].replace("_", " "), "prop")
                    fs = []
                    for f in data["frames"]:
                        ref = p.reference(f["atlas"], str(pathlib.PurePosixPath(member).parent))
                        sr = f["source_rect"]
                        fs.append(
                            {
                                **ref,
                                "canvas": pick([data], "source_canvas", "canvas"),
                                "anchor": data["pivot"],
                                "density": density_of([data]),
                                "rect": f["rect"],
                                "trim": [sr[0], sr[1], sr[2] - sr[0], sr[3] - sr[1]],
                            }
                        )
                    self.clip(
                        asset,
                        "motion",
                        "d45",
                        fs,
                        [f["duration_seconds"] * 1000 for f in data["frames"]],
                        data["loop"],
                    )
                    imported += 1
                elif any(k in data["frames"][0] for k in ["file", "png"]):
                    self.animation(
                        p,
                        member,
                        data,
                        data.get("id", slug(p.spec["archive"].removesuffix(".zip"))),
                    )
                    imported += 1
            elif data.get("clips"):
                cs = data["clips"]
                first = cs[0] if isinstance(cs, list) else next(iter(cs.values()), {})
                if (
                    isinstance(first, dict)
                    and isinstance(first.get("frames"), list)
                    and first["frames"]
                    and isinstance(first["frames"][0], dict)
                    and any(k in first["frames"][0] for k in ["file", "png", "sprite"])
                ):
                    effect = (
                        p.spec["category"] == 5 or "/occult/" in member or "/materials/" in member
                    )
                    defaults = {
                        "pixels_per_unit": data.get("camera", {}).get(
                            "sourcePixelsPerWorldMetre", 256
                        )
                    }
                    # Each effect has its own canvas/pivot; group directional clips by effect.
                    for c in cs if isinstance(cs, list) else [dict(v, id=k) for k, v in cs.items()]:
                        a = self.animation(
                            p,
                            member,
                            {
                                "clips": {c["id"]: c},
                                **{k: v for k, v in data.items() if k != "clips"},
                            },
                            c.get("effect", c["id"]),
                            kind="effect" if effect else "prop",
                            defaults=defaults,
                        )
                        imported += 1
        for member in animation_members:
            base = str(pathlib.PurePosixPath(member).parents[1])
            metadata = p.json(base + "/manifest.json")
            for c in p.json(member):
                self.animation(
                    p,
                    base + "/manifest.json",
                    {"clips": {c["id"]: c}, **{k: v for k, v in metadata.items() if k != "clips"}},
                    c["asset"],
                )
                imported += 1
        # Hand-authored generic runtime additions have explicit nonstandard manifests.
        for member in sorted(p.names):
            if member.endswith("animation.json") and p.spec["category"] != 2:
                data = p.json(member)
                if data.get("actions"):
                    self.animation(
                        p,
                        member,
                        data,
                        "waypoint",
                        kind="effect",
                        defaults={
                            "canvas": data["canvas_px"],
                            "pivot_px": data["pivot_px_top_left"],
                            "pixels_per_unit": data["pixels_per_unit"],
                        },
                    )
                    imported += 1
        if not imported:
            raise ValueError("Unclassified current world package: " + p.spec["archive"])
        self.dispositions.append(
            {"archive": p.spec["archive"], "status": "imported", "metadataGroups": imported}
        )

    def delivered_package(self, p):
        """Delivered atlas/sequence contracts selected explicitly in library-packs."""
        spec = p.spec
        data = p.json(spec["manifest"])
        base = str(pathlib.PurePosixPath(spec["manifest"]).parent)
        kind = spec.get("kind", "prop")

        def sequence(
            identity,
            name,
            meta,
            frames,
            holds,
            *,
            loop=False,
            heading="d45",
            end="hold",
            markers=None,
        ):
            asset = self.asset(identity, identity.replace("_", " ").title(), kind)
            asset["mirroring"] = False
            refs = [
                self.frame(p, f, [meta, data], base, density=density_of([meta, data]))
                for f in frames
            ]
            self.clip(
                asset,
                name,
                heading,
                refs,
                [
                    t
                    * 1000
                    / pick([meta, data], "timing_hz", "timebase_hz", "fps_timebase", default=60)
                    for t in holds
                ],
                loop,
                end,
                markers,
            )
            return asset

        def atlas(identity, meta, clips):
            if "density" in spec:
                meta = {**meta, "pixels_per_unit": spec["density"]}
            image = meta["atlas"]
            columns = meta.get("atlas_columns", meta.get("columns"))
            if isinstance(image, dict):
                columns = image["columns"]
                image = image["file"]
            w, h = meta.get("cell_size", meta.get("native_cell_size"))
            for name, clip in clips.items():
                indices = clip.get("frames", clip.get("sequence"))
                records = [
                    {
                        "file": image,
                        "canvas": [w, h],
                        "rect": [(i % columns) * w, (i // columns) * h, w, h],
                        "trim": [0, 0, w, h],
                    }
                    for i in indices
                ]
                holds = clip.get("duration_ticks", clip.get("holds_ticks", clip.get("hold_ticks")))
                sequence(identity, name, meta, records, holds, loop=clip.get("loop", False))

        if spec["format"] == "atlas-characters":
            for identity, meta in data["characters"].items():
                atlas(identity, meta, {"work": meta["work_loop"]})
        elif spec["format"] == "atlas-actor":
            clips = data.get("clips")
            if clips is None:
                clip = data.get("animation", data.get("clip"))
                clips = {clip["name"]: clip}
            atlas(spec["identity"], data, clips)
        elif spec["format"] == "frame-props":
            records = data if isinstance(data, list) else data.get("assets", [data])
            for meta in records:
                identity = meta.get("id", meta.get("name", spec.get("identity"))) + "_opening"
                frames = meta["frames"]
                context = {**data, **meta} if isinstance(data, dict) else meta
                context["pivot_pixels"] = pick(
                    [meta, data], "pivotPixels", "pivot_px", "pivot_top_left_px"
                )
                context["canvas_px"] = pick([meta, data], "canvas_px", "canvas", default=None)
                context["pixels_per_unit"] = pick(
                    [meta, data], "suggestedPixelsPerUnit", "pixels_per_unit", default=256
                )
                if meta.get("approximate_height_m"):
                    from PIL import Image

                    member = p.locate(frames[0]["file"], base)
                    with p.zip.open(member) as stream, Image.open(stream) as image:
                        bounds = image.convert("RGBA").getchannel("A").getbbox()
                    if bounds is None:
                        raise ValueError("Cannot register empty prop: " + identity)
                    context["pixels_per_unit"] = (bounds[3] - bounds[1]) / meta[
                        "approximate_height_m"
                    ]
                holds = [pick([f], "holdTicks", "hold_ticks", "ticks") for f in frames]
                markers = [
                    {"id": e["name"], "atMs": e["tick"] * 1000 / 60} for e in meta.get("events", [])
                ]
                sequence(
                    identity,
                    "open" if meta.get("states") else "search",
                    context,
                    frames,
                    holds,
                    markers=markers,
                )
                sequence(identity, "idle", context, frames[:1], [60], loop=True)
                sequence(identity, "looted", context, frames[-1:], [60], loop=True)
        elif spec["format"] == "portal":
            for name, clip in data["animations"].items():
                frames = [{"file": "runtime/frames/" + f["id"] + ".png"} for f in clip["frames"]]
                sequence(
                    "town_portal",
                    name,
                    data,
                    frames,
                    [f["ticks"] for f in clip["frames"]],
                    loop=clip["loop"],
                    end="hide" if clip["terminal_state"] == "absent" else "hold",
                )
        elif spec["format"] == "hero-interactions":
            for direction, meta in data["directions"].items():
                for name, clip in data["clips"].items():
                    sequence(
                        "hero_interactions",
                        name,
                        meta,
                        [meta["frames"][f] for f in clip["frames"]],
                        clip["hold_ticks_60hz"],
                        loop=clip["loop"],
                        heading=HEADINGS[direction],
                    )
        else:
            raise ValueError("Unsupported delivered package format: " + spec["format"])
        self.dispositions.append({"archive": spec["archive"], "status": "imported"})

    def enemy_catalog(self, p):
        member = next(n for n in p.names if n.endswith("/catalog.json"))
        catalog = p.json(member)
        groups = {g["group_id"]: g for g in catalog["groups"]}
        for actor in catalog["active_five_enemy_state_coverage"]:
            asset = self.asset(actor["enemy_id"], actor["actor"], "character")
            asset["mirroring"] = False
            for state in ["movement", "attack", "spawn", "hit", "defeat"]:
                sel = actor[state]
                g = groups[sel["group_id"]]
                c = next(c for c in g["clips"] if c["clip_id"] == sel["clip_id"])
                ar = g["archives"]["runtime"]
                name = ar.get(
                    "filename",
                    pathlib.PurePosixPath(ar.get("file_relative_to_asset_root", "")).name,
                )
                runtime = self.by_name[name]
                if c.get("frames"):
                    fs = c["frames"]
                    timing = c["timing"]
                    raw = c.get("authoritative_clip_metadata", {})
                    holds = timing.get("hold_ticks_in_order") or [
                        t["hold_ticks"] for t in timing.get("timeline", raw.get("timeline", []))
                    ]
                    # Current import corrections are embedded and explicitly scoped per clip.
                    matches = []
                    for doc in g.get("import_contracts", {}).values():
                        if c["clip_id"] in doc.get("clips", {}):
                            matches.append(doc["clips"][c["clip_id"]])
                    correction = matches[0] if matches else {}
                    pivot = pick(
                        [correction, c],
                        "native_pivot_top_left_px",
                        "pivot_top_left_px",
                        default=c.get("pivot", {}).get("top_left_px"),
                    )
                    density = pick(
                        [correction, raw],
                        "pixels_per_unit",
                        "pixels_per_unit_at_proposed_base",
                        "native_pixels_per_unit",
                        default=256,
                    )
                    frames = []
                    for f in fs:
                        f = {**f.get("source_manifest_frame", {}), **f}
                        frame = self.frame(runtime, f, [raw, c], density=density, anchor=pivot)
                        offset = pick(
                            [correction],
                            "equivalent_offset_reference_px",
                            "offset_reference_px_screen_xy",
                            default=[0, 0],
                        )
                        if any(offset):
                            frame["visualOffsetPx"] = [
                                offset[0] * density / 256,
                                offset[1] * density / 256,
                            ]
                        frames.append(frame)
                    if not holds:
                        holds = [
                            pick(
                                [f.get("source_manifest_frame", {}), f],
                                "hold_ticks_60hz",
                                "hold_ticks",
                            )
                            for f in fs
                        ]
                    timeline = timing.get("timeline", raw.get("timeline", []))
                    if timeline and len(timeline) != len(frames):
                        offset = 1 if min(t["cel"] for t in timeline) == 1 else 0
                        frames = [frames[t["cel"] - offset] for t in timeline]
                    loop = timing.get("loop", state == "movement")
                    self.clip(
                        asset,
                        "move" if state == "movement" else state,
                        "d90",
                        frames,
                        [(h or 1) * 1000 / 60 for h in holds],
                        loop,
                    )
                else:
                    member = c["manifest_archive_member"]
                    member = runtime.locate(member)
                    data = runtime.json(member)
                    raw = c["authoritative_clip_metadata"]
                    common = {**data, "clips": {state: raw}}
                    self.animation(
                        runtime,
                        member,
                        common,
                        actor["enemy_id"],
                        actor["actor"],
                        "character",
                        "d90",
                        {
                            "pixels_per_unit": 256,
                            "pivot_px": [320, 608]
                            if actor["enemy_id"] == "CT04"
                            else [416, 584]
                            if actor["enemy_id"] == "CT01"
                            else [204, 554]
                            if actor["enemy_id"] == "SK03"
                            else [448, 488]
                            if actor["enemy_id"] == "ZB04"
                            else [320, 500],
                        },
                    )
            self.dispositions.append(
                {"actor": actor["enemy_id"], "status": "imported-current-five"}
            )

    def enemy_overnight(self, p):
        baseline = p.json("baseline_DR_reference/manifest.json")
        for actor in baseline["actors"]:
            runtime = self.by_name[actor["artifacts"]["runtime"]["file_name"]]
            asset = self.asset(actor["id"], actor["name"], "character")
            asset["mirroring"] = False
            h = actor["headings"]["DR"]
            for name, c in h["clips"].items():
                frames = [
                    self.frame(
                        runtime,
                        {"file": f, "sha256": c["frame_sha256"][i]},
                        [],
                        density=c["estimated_pixels_per_unit"],
                        anchor=c["pivot_pixels"],
                    )
                    for i, f in enumerate(c["frame_paths"])
                ]
                self.clip(
                    asset, name, "d90", frames, [t * 1000 / 60 for t in c["hold_ticks"]], c["loop"]
                )
            if h.get("idle_still_path"):
                f = self.frame(
                    runtime,
                    {"file": h["idle_still_path"]},
                    [],
                    density=h["estimated_pixels_per_unit"],
                    anchor=h["pivot_pixels"],
                )
                self.clip(asset, "idle", "d90", [f], [1000], True)
        inventory = p.json("pack_inventory.json")
        for pack in inventory["packs"]:
            if pack["category"] == "baseline":
                continue
            runtime = self.by_name[pack["runtime_artifacts"][0]["file_name"]]
            asset = self.assets["library-" + slug(pack["actor_id"])]
            # Heading metadata files are authoritative even when the handoff has no local copy.
            count = 0
            for member in sorted(runtime.names):
                if not member.endswith(("animation.json", "animation_manifest.json")):
                    continue
                data = runtime.json(member)
                if not data.get("clips"):
                    continue
                parts = member.split("/")
                heading = next((s for s in parts if s in HEADINGS), None)
                if not heading:
                    facing = str(data.get("facing", ""))
                    heading = next(
                        (h for h in HEADINGS if re.search(r"\b" + h + r"\b", facing)), None
                    )
                if heading:
                    self.animation(
                        runtime,
                        member,
                        data,
                        pack["actor_id"],
                        pack["actor_name"],
                        "character",
                        HEADINGS[heading],
                        asset["clips"]["move"]["d90"]["frames"][0],
                    )
                    count += 1
                elif pack["category"] == "DR_reaction_extension":
                    self.animation(
                        runtime,
                        member,
                        data,
                        pack["actor_id"],
                        pack["actor_name"],
                        "character",
                        "d90",
                        asset["clips"]["move"]["d90"]["frames"][0],
                    )
                    count += 1
                elif "directions" in data or "headings" in data:
                    for heading, hd in data.get("directions", data.get("headings")).items():
                        self.animation(
                            runtime,
                            member,
                            {**data, **hd},
                            pack["actor_id"],
                            pack["actor_name"],
                            "character",
                            HEADINGS[heading],
                            asset["clips"]["move"]["d90"]["frames"][0],
                        )
                        count += 1
                else:
                    for name, c in data["clips"].items():
                        heading = c.get("facing", name.split("_")[0])
                        if heading in HEADINGS:
                            action = c.get("action", name.removeprefix(heading + "_"))
                            self.animation(
                                runtime,
                                member,
                                {**data, "clips": {action: c}},
                                pack["actor_id"],
                                pack["actor_name"],
                                "character",
                                HEADINGS[heading],
                                asset["clips"]["move"]["d90"]["frames"][0],
                            )
                            count += 1
            if not count:
                raise ValueError("Unclassified enemy extension: " + runtime.spec["archive"])
            self.dispositions.append(
                {"archive": runtime.spec["archive"], "status": "merged-extension"}
            )
        for actor in p.json("actor_coverage.json")["actors"]:
            if actor["group"] != "new_18":
                continue
            asset = self.assets["library-" + slug(actor["id"])]
            for state, headings in actor["coverage"].items():
                expected = {HEADINGS[h] for h in headings}
                if set(asset["clips"].get(state, {})) != expected:
                    raise ValueError(
                        "Coverage differs from current handoff: " + actor["id"] + "/" + state
                    )


def build(root, specs, index, artwork=()):
    resolver = SourceResolver(root, index)
    with ExitStack() as stack:
        packages = []
        for spec in specs:
            stream = stack.enter_context(resolver.open("archive:" + spec["archive"]))
            packages.append(Package(spec, stack.enter_context(zipfile.ZipFile(stream))))
        importer = Importer(packages)
        for p in packages:
            if "Scenic_Mechanisms" in p.spec["archive"]:
                p.peers = [
                    peer
                    for peer in packages
                    if peer is not p and "Scenic_Mechanisms" in peer.spec["archive"]
                ]
            if p.spec["archive"] == "Lantern_Interaction_Cues_v1_Assets.zip":
                p.peers = [
                    peer
                    for peer in packages
                    if peer.spec["archive"] == "Lantern_Interaction_Cues_v1_Source_and_Review.zip"
                ]
                for peer in p.peers:
                    p.names.update(n for n in peer.names if n.endswith("/manifest.json"))
        for p in sorted(
            packages,
            key=lambda p: any(t in p.spec["archive"] for t in ["Canal_Workshop", "Crypt_Entry"]),
        ):
            if p.spec["category"] == 0 and "enemy_animation_handoff" in p.spec["archive"]:
                importer.enemy_catalog(p)
        for p in packages:
            if p.spec["category"] == 0 and "Overnight" in p.spec["archive"]:
                importer.enemy_overnight(p)
        for p in packages:
            if p.spec["category"] == 0:
                continue
            if p.spec["category"] == 2 and "runtime" in p.spec["archive"].lower():
                continue
            if p.spec["archive"] == "Lantern_Interaction_Cues_v1_Source_and_Review.zip":
                continue
            importer.package(p)
        used = {
            f["group"]
            for a in importer.assets.values()
            for d in a["clips"].values()
            for c in d.values()
            for f in c["frames"]
        }
        for record in artwork:
            member = record["member"]
            original = resolver.read("file:library-artwork/" + member)
            dimensions = list(struct.unpack(">II", original[16:24]))
            if original[:8] != b"\x89PNG\r\n\x1a\n" or dimensions != record["canvas"]:
                raise ValueError("Artwork registration differs: " + member)
            asset = importer.asset(
                record["id"], record["label"], record["type"], record["projection"]
            )
            asset["limitations"] = [
                "Intact supplied artwork; world-size registration is an editable starting point."
            ]
            frame = {
                "group": "library-artwork",
                "member": member,
                "canvas": record["canvas"],
                "anchor": record["anchor"],
                "density": record["density"],
            }
            importer.clip(asset, "still", "d45", [frame], [1000], True)
        selected = {
            p.spec["archive"]: (
                "imported"
                if p.spec["group"] in used
                else "metadata-support"
                if p.spec["category"] == 0 or "Source_and_Review" in p.spec["archive"]
                else "excluded-current-handoff-selection"
            )
            for p in packages
        }
        for archive in sorted(root.rglob("*.zip")):
            relative = archive.relative_to(root).as_posix()
            reason = next(
                (
                    selected[name]
                    for name, info in index["archives"].items()
                    if info.get("pathHint", name) == relative and name in selected
                ),
                None,
            )
            if reason is None:
                lower = relative.lower()
                reason = (
                    "deferred-title-loading"
                    if relative.startswith("Title and Loading/")
                    else "rejected-or-superseded"
                    if any(
                        x in lower
                        for x in [
                            "rejected",
                            "earlier",
                            "superseded",
                            "alternate concept",
                            "unreviewed",
                        ]
                    )
                    else "existing-hero-selection"
                    if relative.startswith("Characters/Hero/")
                    else "source-or-review-only"
                )
            importer.dispositions.append({"path": relative, "status": reason})
        return {
            "schemaVersion": 1,
            "assets": list(importer.assets.values()),
            "dispositions": importer.dispositions,
        }


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    index = load_index(PROJECT / "assets/sources.json")
    root = (
        pathlib.Path(
            __import__("os").environ.get(
                "ASSET_LIBRARY_ROOT", pathlib.Path.home() / "Documents/Asset Library"
            )
        )
        / index["libraryDirectory"]
    )
    specs = json.loads((PROJECT / "assets/library-packs.json").read_text())["packs"]
    artwork = [
        record
        for name in json.loads((PROJECT / "assets/library-artwork.json").read_text())["includes"]
        for record in json.loads((PROJECT / "assets" / safe_relative(name)).read_text())["assets"]
    ]
    result = build(root, specs, index, artwork)
    pathlib.Path(args.output).write_text(json.dumps(result, separators=(",", ":")) + "\n")
    print(f"Normalized {len(result['assets'])} logical world assets")
