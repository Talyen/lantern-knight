"""Adapt supplied loot and numbered fire sequences to the existing clip contract."""

import pathlib
import re


def frame_sha256(record, shared_states=None):
    registration = record.get("source_registration", {})
    state = (shared_states or {}).get(record.get("shared_state_id"), {})
    return (
        record.get("sha256")
        or record.get("png_sha256")
        or registration.get("delivery_sha256")
        or (registration.get("sha256") if registration.get("file") == record.get("file") else None)
        or state.get("sha256")
    )


def interactable_sequences(package, member, data):
    """Keep each supplied scene prop and resolution as its own playable asset."""
    if not isinstance(data, dict):
        return None
    base = str(pathlib.PurePosixPath(member).parent)
    records = None
    frame_folders = {"native": "native", "runtime": "runtime"}
    declared_order = None
    if (
        pathlib.PurePosixPath(member).name == "timing.json"
        and data
        and all(
            isinstance(v, dict) and v.get("action") in ("open", "break") and v.get("frame_count")
            for v in data.values()
        )
    ):
        records = data
    elif (
        pathlib.PurePosixPath(member).name == "metadata.json"
        and data.get("native_canvas")
        and (data.get("timing_ms") or data.get("frame_duration_ms"))
    ):
        records = {data.get("name", data.get("asset", "interact")): data}
    elif pathlib.PurePosixPath(member).name == "manifest.json":
        animation = data.get("animation", {})
        if not isinstance(animation, dict):
            animation = {}
        durations = data.get(
            "frame_ms", data.get("duration_ms", animation.get("frame_durations_ms"))
        )
        native_zero = str(pathlib.PurePosixPath(base) / "native_frames/00.png")
        runtime_zero = str(pathlib.PurePosixPath(base) / "runtime_frames/00.png")
        if (
            data.get("scene") is not None
            and str(pathlib.PurePosixPath(base) / "closed.png") in package.names
            and str(pathlib.PurePosixPath(base) / "open.png") in package.names
            and durations is not None
            and native_zero in package.names
            and runtime_zero in package.names
        ):
            if data.get("loop", animation.get("loop")) is not False or not (
                animation.get("hold_final") is True
                or "hold" in str(data.get("on_complete", "")).lower()
            ):
                raise ValueError("Scene opening must declare one-shot playback and a final hold")
            record = {
                "action": "open",
                "durations_ms": durations,
                "frame_count": data.get("frame_count", data.get("frames", len(durations))),
                "native_canvas": data.get(
                    "native_canvas", data.get("native_frame_size", package.dimensions(native_zero))
                ),
                "runtime_canvas": data.get(
                    "runtime_canvas",
                    data.get("runtime_frame_size", package.dimensions(runtime_zero)),
                ),
                "pivot_native": data.get(
                    "anchor_native",
                    data.get(
                        "native_anchor",
                        data.get("native_anchor_pixels", data.get("native_anchor_bottom_contact")),
                    ),
                ),
                "pivot_runtime": data.get(
                    "runtime_anchor",
                    data.get("anchor_pixels", data.get("runtime_anchor_bottom_contact")),
                ),
            }
            declared_order = data.get("frame_files")
            frame_folders = {"native": "native_frames", "runtime": "runtime_frames"}
            records = {data.get("name", data.get("prop", "interact")): record}
    if records is None:
        return None
    result = []
    for name, record in records.items():
        durations = record.get(
            "durations_ms",
            record.get(
                "frame_durations_ms", record.get("timing_ms", record.get("frame_duration_ms"))
            ),
        )
        count = record.get("frame_count", record.get("authored_cels", len(durations)))
        if not isinstance(durations, list) or len(durations) != count or count < 1:
            raise ValueError("Interactable timing must cover every supplied cel")
        for variant in ("native", "runtime"):
            pivot = record.get(
                "pivot_" + variant,
                record.get(
                    variant + "_pivot_pixels",
                    record.get("ground_anchor_" + variant, record.get("ground_contact_" + variant)),
                ),
            )
            if pivot is None and variant == "runtime":
                original = record.get("ground_anchor_native")
                if original and record.get("runtime_canvas"):
                    pivot = [
                        original[i] * record["runtime_canvas"][i] / record["native_canvas"][i]
                        for i in range(2)
                    ]
            if pivot is None:
                raise ValueError("Interactable is missing its supplied ground pivot")
            if record.get("action") and frame_folders[variant] == variant:
                files = [
                    str(pathlib.PurePosixPath(base) / f"{variant}/{name}_{i:02d}.png")
                    for i in range(count)
                ]
                if any(f not in package.names for f in files):
                    raise ValueError("Interactable is missing a supplied cel")
            else:
                folder = str(pathlib.PurePosixPath(base) / frame_folders[variant]) + "/"
                candidates = [
                    n for n in package.names if n.startswith(folder) and n.endswith(".png")
                ]
                indexed = {}
                for path in candidates:
                    match = re.fullmatch(
                        r"(?:frame_)?(\d{2})_.+|(?:frame_)?(\d{2})",
                        pathlib.PurePosixPath(path).stem,
                    )
                    if match:
                        index = int(match.group(1) or match.group(2))
                        if index in indexed:
                            raise ValueError("Ambiguous interactable cel index")
                        indexed[index] = path
                if set(indexed) != set(range(count)):
                    raise ValueError("Interactable drawings do not match the declared cel sequence")
                order = list(range(count))
                if declared_order is not None:
                    if not isinstance(declared_order, list) or len(declared_order) != count:
                        raise ValueError("Declared interactable order does not cover every cel")
                    order = []
                    for file in declared_order:
                        supplied = pathlib.PurePosixPath(file)
                        if supplied.parent != pathlib.PurePosixPath(
                            "runtime_frames"
                        ) or not re.fullmatch(r"\d{2}\.png", supplied.name):
                            raise ValueError(
                                "Declared interactable cel must name a runtime drawing"
                            )
                        order.append(int(supplied.stem))
                    if set(order) != set(range(count)):
                        raise ValueError("Declared interactable order repeats or omits a cel")
                files = [indexed[i] for i in order]
            canvas = package.dimensions(files[0])
            if any(package.dimensions(f) != canvas for f in files):
                raise ValueError("Interactable cels do not share the supplied canvas")
            native = record.get("native_canvas", record.get("native_cell"))
            runtime = record.get("runtime_canvas", record.get("runtime_cell"))
            if native is None:
                native = package.dimensions(package.locate(f"native/{name}_00.png", base))
                runtime = package.dimensions(package.locate(f"runtime/{name}_00.png", base))
            supplied_canvas = native if variant == "native" else runtime
            if tuple(supplied_canvas) != tuple(canvas):
                raise ValueError("Interactable canvas differs from its supplied drawings")
            density = 256 * canvas[0] / runtime[0]
            frames = [
                {"file": f, "duration_ms": d, "terminal_hold": d == 0}
                for f, d in zip(files, durations)
            ]
            holds = record.get("holds", {})
            if record.get("action"):
                action = record["action"]
                segments = {action: list(range(count))}
                holds = {
                    "closed" if action == "open" else "intact": 0,
                    "opened" if action == "open" else "broken": count - 1,
                }
            else:
                segments = record.get("segments", {"interact": list(range(count))})
                holds = holds or {
                    "ready": record.get("ready_frame", 0),
                    "completed": record.get(
                        "completed_frame", record.get("completion_frame", count - 1)
                    ),
                }
            clips = {}
            for clip, indices in segments.items():
                if not indices or any(type(i) is not int or i < 0 or i >= count for i in indices):
                    raise ValueError("Interactable segment references an absent cel")
                selected = [frames[i] for i in indices]
                if any(f["duration_ms"] == 0 for f in selected[:-1]):
                    raise ValueError("Interactable segment crosses an externally controlled hold")
                clips[clip] = {"frames": selected, "loop": False, "end_behavior": "hold"}
                event = record.get("completion_event_frame", record.get("completion_frame"))
                if event in indices:
                    clips[clip]["events"] = [
                        {
                            "id": "complete",
                            "time_ms": sum(
                                f["duration_ms"] for f in selected[: indices.index(event)]
                            ),
                        }
                    ]
            for hold, index in holds.items():
                if type(index) is not int or index < 0 or index >= count:
                    raise ValueError("Interactable hold references an absent cel")
                clips[hold] = {
                    "frames": [{"file": files[index], "duration_ms": 1000}],
                    "loop": False,
                }
            result.append(
                (
                    str(name) + "-" + variant,
                    {
                        "canvas": list(canvas),
                        "pivot_px": pivot,
                        "pixels_per_unit": density,
                        "clips": clips,
                    },
                )
            )
    return result


def supplied_sequences(package, member, data):
    if not isinstance(data, dict):
        return data
    base = str(pathlib.PurePosixPath(member).parent)
    frames = data.get("frames")
    if isinstance(frames, list) and frames and all(isinstance(f, dict) for f in frames):
        frames = [
            {**f, "sha256": identity}
            if (identity := frame_sha256(f, data.get("shared_states")))
            else f
            for f in frames
        ]
        if frames != data["frames"]:
            data = {**data, "frames": frames}
    if data.get("optional") and data.get("recommended_preview_variant") and data.get("clip"):
        raw = package.json(package.locate(data["clip"] + ".json", base))
        original = raw["frames"]
        if len(original) != len(frames) or any(
            a.get("drawing") != b.get("drawing") for a, b in zip(original, frames)
        ):
            raise ValueError("Optional registration does not match the declared raw drawing order")
        timing = ("hold_ticks_60hz", "hold_indefinitely", "terminal_hold", "duration_ms")
        return {
            **data,
            "loop": raw["loop"],
            "terminal_hold": raw.get("terminal_hold"),
            "frames": [
                {**f, **{k: source[k] for k in timing if k in source}}
                for f, source in zip(frames, original)
            ],
        }
    if isinstance(data.get("timings"), dict) and isinstance(frames, list) and frames:
        clips = {}
        for name, variant in data["timings"].items():
            ticks = variant.get("ticks_60hz")
            if not isinstance(ticks, list) or len(ticks) != len(frames):
                raise ValueError("Timing variant does not cover the exact supplied drawings")
            clips[name] = {
                "frames": [
                    {**f, "duration_ms": hold * 1000 / 60} for f, hold in zip(frames, ticks)
                ],
                "loop": data.get("loop", False),
            }
        return {**data, "clips": clips}
    if (
        data.get("source_rgba_preserved") is True
        and frames
        and all(isinstance(f, dict) and f.get("sha256") for f in frames)
    ):
        canonical_member = str(pathlib.PurePosixPath(base).parent / "manifest.json")
        if canonical_member in package.names:
            canonical = package.json(canonical_member)
            candidates = canonical.get("runtime_frames", canonical.get("frames", []))

            def signature(fs):
                return [(f.get("sha256"), f.get("hold_ticks_60hz")) for f in fs]

            if candidates and signature(candidates) == signature(frames):
                return {**canonical, "frames": candidates}
    if data.get("states") and data.get("id") and isinstance(data.get("atlas"), dict) and frames:
        for parent in pathlib.PurePosixPath(base).parents:
            candidate = str(parent / "manifest.json")
            if candidate not in package.names:
                continue
            manifest = package.json(candidate)
            records = manifest.get("assets", [])
            matching = [
                a for a in records if a.get("id") == data["id"] and a.get("frames") == frames
            ]
            if len(matching) == 1:
                return {**manifest, **data}
    clips = data.get("clips")
    if isinstance(clips, dict) and isinstance(data.get("atlas"), str) and data.get("atlas_columns"):
        normalized = {}
        for name, clip in clips.items():
            indices = clip.get("frames")
            holds = clip.get("duration_ticks")
            if not isinstance(indices, list) or not all(isinstance(i, int) for i in indices):
                return data
            if not isinstance(holds, list) or len(holds) != len(indices):
                raise ValueError("Indexed atlas timing does not cover the exact frame sequence")
            width, height = data["cell_size"]
            columns = data["atlas_columns"]
            if any(i < 0 or i >= data["native_cel_count"] for i in indices):
                raise ValueError("Indexed atlas frame is outside the supplied cel count")
            normalized[name] = {
                **clip,
                "frames": [
                    {
                        "file": data["atlas"],
                        "rect": [i % columns * width, i // columns * height, width, height],
                        "trim": [0, 0, width, height],
                        "duration_ms": hold * 1000 / data["timing_hz"],
                    }
                    for i, hold in zip(indices, holds)
                ],
            }
        return {**data, "canvas": data["cell_size"], "clips": normalized}
    # Cursor locomotion and the native hero expansion use fixed pixel cells.
    # Keep runtime exports intact; native source drawings remain separate images.
    runtime = data.get("runtime", {})
    frames = data.get("runtime_frames", data.get("frames"))
    if (
        package.spec.get("format") == "hero-native"
        and isinstance(frames, list)
        and frames
        and (
            data.get("facing_world_xyz")
            or data.get("runtime_canvas_px")
            or data.get("world_heading")
            or data.get("asset") == "Lantern Hero C / Rust"
            or (runtime.get("cell_size") and runtime.get("pivot_px_top_left"))
            or (data.get("canvas_px") and data.get("pivot_top_left_px"))
        )
    ):
        return {
            **data,
            **runtime,
            "id": data.get("clip_id", data.get("asset", "animation")),
            "canvas": data.get(
                "runtime_canvas_px", data.get("canvas_px", runtime.get("cell_size"))
            ),
            "pivot_px": data.get(
                "pivot_top_left_px", data.get("pivot_px_top_left", runtime.get("pivot_px_top_left"))
            ),
            "pixels_per_unit": data.get(
                "pixels_per_unit",
                data.get("pixels_per_unit_approximate", runtime.get("suggested_pixels_per_unit")),
            ),
            "frames": frames,
            "loop": runtime.get("loop", data.get("loop", bool(data.get("cycle")))),
        }
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
