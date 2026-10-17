"""Adapt supplied loot and numbered fire sequences to the existing clip contract."""

import pathlib
import re


def supplied_sequences(package, member, data):
    if not isinstance(data, dict):
        return data
    base = str(pathlib.PurePosixPath(member).parent)
    if data.get("animation") and data.get("schema") in (
        "lantern-knight.sprite-clip.v1",
        "lantern_knight.sprite_animation.v1",
    ):
        pivot = data.get("pivot_px")
        if isinstance(pivot, dict):
            if pivot.get("origin", "top_left") != "top_left":
                raise ValueError("Unsupported sprite-clip pixel pivot origin")
            pivot = [pivot["x"], pivot["y"]]
        canvas = data.get("canvas", data.get("cell_size_px"))
        if isinstance(canvas, dict):
            canvas = [canvas["width"], canvas["height"]]
        atlas = data.get("atlas")
        atlas = atlas.get("file") if isinstance(atlas, dict) else atlas
        frames = []
        for frame in data["frames"]:
            record = {k: v for k, v in frame.items() if k != "rect"}
            try:
                package.locate(frame["file"], base)
            except ValueError:
                # Atlas coordinates apply only when the standalone cel is absent.
                rect = frame["rect"]
                if isinstance(rect, dict):
                    rect = [rect[k] for k in ("x", "y", "w", "h")]
                if not atlas:
                    raise ValueError("Sprite clip lacks a frame or atlas") from None
                record.update(file=atlas, rect=rect, trim=[0, 0, *canvas])
            frames.append(record)
        normalized = {**data, "canvas": canvas, "pivot_px": pivot, "frames": frames}
        if "pixels_per_unit" in data.get("import", {}):
            normalized["pixels_per_unit"] = data["import"]["pixels_per_unit"]
        clips = {data["animation"]: normalized}
        for name, state in data.get("states", {}).items():
            file = state.get("file") if isinstance(state, dict) else state
            try:
                package.locate(file, base)
            except ValueError:
                # Loose atlas exports omit state PNGs supplied in the runtime archive.
                continue
            clips[name] = {
                "frames": [{"file": file, "duration_ms": 1000}],
                "loop": False,
                "endBehavior": "hold",
            }
        return {**normalized, "clips": clips}
    if (
        all(
            isinstance(data.get(name), dict) and data[name].get("frames")
            for name in ("drop", "idle")
        )
        and data.get("canvas")
        and data.get("rest")
    ):
        clips = {}
        for name in ("drop", "idle"):
            clip = data[name]
            atlas = clip.get("atlas", {})
            records = []
            for i, record in enumerate(clip["frames"]):
                standalone = False
                if record.get("file"):
                    try:
                        package.locate(record["file"], base)
                        standalone = True
                    except ValueError:
                        # Atlas-only exports retain the original standalone filenames.
                        pass
                if standalone:
                    # Standalone exports already contain the supplied drop offset.
                    records.append({k: v for k, v in record.items() if k != "rect"})
                else:
                    rect = record.get("atlas_rect")
                    if rect is None and isinstance(atlas.get("rects"), list):
                        rect = atlas["rects"][i]
                    if not atlas.get("file") or rect is None:
                        raise ValueError("Loot sequence lacks a frame or atlas rectangle")
                    records.append(
                        {
                            **record,
                            "file": atlas["file"],
                            "rect": rect,
                            "trim": [0, 0, *data["canvas"]],
                        }
                    )
            clips[name] = {**clip, "frames": records, "endBehavior": "hold"}
        rest = data["rest"]
        if rest.get("file"):
            clips["rest"] = {
                "frames": [{"file": rest["file"], "duration_ms": 1000}],
                "loop": True,
                "endBehavior": "hold",
            }
        return {**data, "clips": clips}

    frames = data.get("frames")
    canvas = data.get("frame_size", data.get("runtime_size", data.get("canvas")))
    if isinstance(canvas, int):
        canvas = [canvas, canvas]
    if not isinstance(frames, list) or not frames or not canvas:
        return data
    if not all(
        isinstance(f, dict)
        and ("index" in f or "frame" in f)
        and not any(k in f for k in ("file", "png", "sprite", "path", "image"))
        and any(k in f for k in ("hold_60hz", "hold_ticks"))
        for f in frames
    ):
        return data
    # These delivered formats number composite PNGs separately from layer PNGs.
    numbered = {}
    directory = str(pathlib.PurePosixPath(base) / "frames")
    for path in package.names:
        p = pathlib.PurePosixPath(path)
        match = re.fullmatch(r"(?:frame[_-])?(\d+)\.png", p.name)
        if str(p.parent) == directory and match:
            index = int(match.group(1))
            if index in numbered:
                raise ValueError("Ambiguous numbered composite frame")
            numbered[index] = path
    if not numbered:
        return data
    records = []
    indices = [f.get("index", f.get("frame")) for f in frames]
    if set(indices) != set(numbered):
        raise ValueError("Numbered sequence timing does not cover exact composite frames")
    for f, index in zip(frames, indices):
        ticks = f.get("hold_60hz", f.get("hold_ticks"))
        records.append({"file": numbered[index], "duration_ms": ticks * 1000 / 60})
    clips = {
        "loop": {
            "frames": records,
            "loop": data.get("loop", bool(data.get("loop_ticks")) or "composite_order" in data),
            "endBehavior": "hold",
        }
    }
    off = str(pathlib.PurePosixPath(base) / "unlit.png")
    if off in package.names:
        clips["unlit"] = {
            "frames": [{"file": off, "duration_ms": 1000}],
            "loop": False,
            "endBehavior": "hold",
        }
    return {**data, "canvas": canvas, "clips": clips}
