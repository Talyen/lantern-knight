"""Normalize the pinned TEST handoff without changing artwork or registration."""
import hashlib
import json
import os
import pathlib
import struct

from resolver import PROJECT, SourceResolver
from source import read

HEADINGS = {'DL': 'd00', 'DR': 'd90', 'UR': 'd180', 'UL': 'd270'}
CLIPS = {'run': 'walk', 'lantern': 'cast_lantern_flare'}
CATALOG = 'hero_animation_handoff_20261007_v02/catalog.json'


def timing(clip):
    role = clip['role']
    if role == 'ready':
        return [0], [1000], None
    if role == 'lunge':
        indices = [next(i for i, f in enumerate(clip['frame_files']) if pathlib.PurePosixPath(f).stem == t['frame']) for t in clip['timeline']]
        holds = [t['hold_ticks'] * 1000 / 60 for t in clip['timeline']]
        return indices, holds, [300, 1000 * 22 / 60]
    if role == 'sweep':
        timeline = clip['timeline_ms']
        holds = [t['duration_ms'] for t in timeline]
        active = [i for i, t in enumerate(timeline) if 'crossing' in t['beat'].lower() or t['beat'].lower() == 'sweep']
        return [t['drawing'] for t in timeline], holds, [sum(holds[:min(active)]), sum(holds[:max(active) + 1])]
    holds = clip.get('holds_ms') or [t * 1000 / 60 for t in clip['holds_ticks']]
    return clip.get('timeline_frame_indices', list(range(len(holds)))), holds, None


def describe(root, index):
    resolver = SourceResolver(root, index)
    catalog = json.loads(read(root, index, 'hero-handoff', CATALOG, resolver))
    for package in catalog['packages']:
        identity = index['archives'][index['archiveGroups']['hero-' + package['package_id']]]
        if any(identity[k] != package[k] for k in ('sha256', 'bytes')):
            raise ValueError('hero package differs from handoff: ' + package['package_id'])
    frames, clips, recipes, limits = [], [], [], []
    for clip in catalog['clips']:
        group = 'hero-' + clip['package_id']
        indices, holds, damage = timing(clip)
        role, heading = CLIPS.get(clip['role'], clip['role']), HEADINGS[clip['direction']]
        by_index = {}
        verified = {f['runtime_archive_member']: f['sha256'] for f in clip.get('verified_frame_inventory', [])}
        for i in sorted(set(indices)):
            member = clip['frame_files'][i]
            data = read(root, index, group, member, resolver)
            h = hashlib.sha256(data).hexdigest()
            drawing = clip['drawings'][i] if clip['role'] == 'sweep' else None
            expected = verified.get(member) or (drawing or {}).get('runtime_sha256')
            if expected and h != expected:
                raise ValueError('hero frame differs: ' + member)
            if data[:8] != b'\x89PNG\r\n\x1a\n' or data[12:16] != b'IHDR':
                raise ValueError('hero frame must be PNG: ' + member)
            width, height, depth, color = struct.unpack('>IIBB', data[16:26])
            if depth != 8 or color != 6:
                raise ValueError('hero frame must be RGBA8: ' + member)
            canvas = drawing['size'] if drawing else clip['canvas_px']
            if canvas != [width, height]:
                raise ValueError('hero frame canvas differs: ' + member)
            fid = f'{role}-{heading}-{i:02}'
            by_index[i] = fid
            frames.append({'id': fid, 'group': group, 'member': member, 'sha256': h,
                'registration': {'canvas': canvas,
                    'density': drawing['pixels_per_unit'] if drawing else clip['pixels_per_unit'],
                    'anchor': drawing['pivot_top_left'] if drawing else clip['pivot_top_left_px']}})
        clips.append({'id': role, 'heading': heading, 'frames': [by_index[i] for i in indices],
            'durationsMs': holds, 'loop': role in ('ready', 'idle', 'walk'), 'notifies': []})
        recipe = {'holdsMs': holds}
        if damage:
            recipe['damageMs'] = damage
        if role == 'cast_lantern_flare':
            recipe['pulseMs'] = sum(holds[:4])
        recipes.append((role, heading, recipe))
        limits.extend(clip.get('limits', []))
    authored = {}
    for role, heading, recipe in recipes:
        authored.setdefault(role, {})[heading] = recipe
    for screen, heading in {'D': 'd45', 'R': 'd135', 'U': 'd225', 'L': 'd315'}.items():
        group = 'hero-run_' + screen
        manifest = json.loads(read(root, index, group, 'manifest.json', resolver))
        density = next(manifest[k] for k in ('pixels_per_unit_APPROXIMATE', 'suggested_pixels_per_unit_APPROXIMATE', 'approximate_pixels_per_unit') if k in manifest)
        ids, holds = [], []
        for i, frame in enumerate(manifest['frames']):
            data = read(root, index, group, frame['file'], resolver)
            digest = hashlib.sha256(data).hexdigest()
            if frame.get('sha256', digest) != digest:
                raise ValueError('cardinal run frame differs: ' + screen + '/' + frame['file'])
            if data[:8] != b'\x89PNG\r\n\x1a\n' or struct.unpack('>IIBB', data[16:26]) != (*manifest['canvas'], 8, 6):
                raise ValueError('cardinal run must retain native RGBA8 canvas')
            fid = f'walk-{heading}-{i:02}'
            ids.append(fid)
            holds.append(frame.get('hold_ticks_60hz', frame.get('duration_ticks', 5)) * 1000 / 60)
            frames.append({'id': fid, 'group': group, 'member': frame['file'], 'sha256': digest,
                'registration': {'canvas': manifest['canvas'], 'anchor': manifest['pivot_top_left'], 'density': density}})
        if abs(sum(holds) - 40000 / 60) > .001:
            raise ValueError('cardinal run must preserve its 40-tick cycle')
        clips.append({'id': 'walk', 'heading': heading, 'frames': ids, 'durationsMs': holds, 'loop': True, 'notifies': []})
        authored['walk'][heading] = {'holdsMs': holds}
        limits.extend(manifest.get('limitations', []))
    return {'frames': frames, 'clips': clips, 'timings': authored, 'limitations': list(dict.fromkeys(limits)),
        'handoffSha256': index['archives'][index['archiveGroups']['hero-handoff']]['sha256']}


if __name__ == '__main__':
    index = json.loads((PROJECT / 'assets/sources.json').read_text())
    library = pathlib.Path(os.environ.get('ASSET_LIBRARY_ROOT', pathlib.Path.home() / 'Documents/Asset Library'))
    print(json.dumps(describe(library / index['libraryDirectory'], index)))
