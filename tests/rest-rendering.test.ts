import { readRegistration } from '../tools/assets/data';
import { readAsset } from '../tools/assets/io';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { Simulation } from '../src/core/simulation';
import { InkRoom } from '../src/presentation/ink-room';
import { content, heightAt } from '../src/content/world';
import { worldVisuals, areaArtAssets } from '../src/content/world-art';
import { assetCatalog } from '../src/content/visuals';
import { makeCamera } from '../src/core/camera';
import { sceneryRegistration } from '../src/content/scenery-registration';
import type { PackLease } from '../src/assets/loader';
import { parseManifest } from '../src/assets/schema';

test('painted geometry and cutouts meet their authored collision assemblies', async () => {
  const receipts = JSON.parse(await readAsset('staging/ink/derivatives.json', 'utf8')).frames as {
    pack: string;
    id: string;
    uniformScale: number;
    paddingOffset: number[];
  }[];
  for (const area of content.areas.values()) {
    const packs = new Map<string, PackLease>();
    for (const id of areaArtAssets(area)) {
      const manifest = parseManifest(
        JSON.parse(await readAsset(`public/${assetCatalog[id]}`, 'utf8')),
      );
      packs.set(id, {
        manifest,
        textures: new Map(manifest.pages.map((p) => [p.id, new T.Texture()])),
      } as PackLease);
    }
    const group = new T.Group(),
      room = new InkRoom(area, packs, group, makeCamera(16 / 9), undefined, readRegistration());
    room.build();
    try {
      assert.ok(room.sprites.every((s) => s.geometry instanceof T.PlaneGeometry));
      for (const wall of worldVisuals[area.id]!.walls) {
        if (area.id === 'court') {
          assert.ok(room.graveyard!.architecture.parts.length > 0);
          const collider = area.props.find((p) => p.id === wall.id)!;
          assert.ok(collider);
          assert.ok(
            Math.abs(
              collider.rotation! - Math.atan2(wall.to.z - wall.from.z, wall.to.x - wall.from.x),
            ) < 1e-6,
          );
          continue;
        }
        if (wall.surface === 'masonry') {
          const face = room.architecture!.parts.find(
            (m) => m.userData.artPart.id === wall.id + '-face',
          )!;
          assert.ok(face);
          assert.ok(face.geometry instanceof T.PlaneGeometry);
          assert.ok(
            Math.abs(
              (face.geometry as T.PlaneGeometry).parameters.width -
                Math.hypot(wall.to.x - wall.from.x, wall.to.z - wall.from.z),
            ) < 1e-6,
          );
          continue;
        }
        const cards = room.sprites.filter((s) => s.mesh.userData.siteWall === wall.id);
        assert.ok(cards.length > 0);
        for (const [card, endpoint, expected] of [
          [cards[0]!, 0, wall.from],
          [cards.at(-1)!, 1, wall.to],
        ] as const) {
          if (area.id === 'court') {
            const point = new T.Vector3().fromBufferAttribute(
              card.geometry.getAttribute('position'),
              endpoint ? 3 : 2,
            );
            card.mesh.updateMatrixWorld(true);
            point.applyMatrix4(card.mesh.matrixWorld);
            assert.ok(Math.hypot(point.x - expected.x, point.z - expected.z) < 0.01, wall.id);
            assert.ok(Math.abs(point.y - heightAt(area, expected.x, expected.z)) < 0.01, wall.id);
            continue;
          }
          const clip = card.animator.frame,
            r = [...sceneryRegistration].find((r) => r.id === clip)!;
          assert.ok('sockets' in r);
          const d = receipts.find((d) => d.pack === card.manifest.asset.id && d.id === clip)!,
            socket = r.sockets[endpoint]!,
            frame = card.frameIndex.get(clip)!,
            [x, y, w, h] = frame.trim;
          const tx = (socket[0] * d.uniformScale + d.paddingOffset[0]! - x) / w,
            ty = (socket[1] * d.uniformScale + d.paddingOffset[1]! - y) / h,
            vertices = card.geometry.getAttribute('position');
          const point = new T.Vector3()
            .fromBufferAttribute(vertices, 0)
            .lerp(new T.Vector3().fromBufferAttribute(vertices, 1), tx)
            .lerp(
              new T.Vector3()
                .fromBufferAttribute(vertices, 2)
                .lerp(new T.Vector3().fromBufferAttribute(vertices, 3), tx),
              ty,
            );
          card.mesh.updateMatrixWorld(true);
          point.applyMatrix4(card.mesh.matrixWorld);
          assert.ok(Math.hypot(point.x - expected.x, point.z - expected.z) < 0.01, wall.id);
          assert.ok(Math.abs(point.y - heightAt(area, expected.x, expected.z)) < 0.01, wall.id);
        }
      }
      if (area.id === 'upper-landing') {
        const sim = new Simulation(142, area.id);
        Object.assign(sim.hero, { x: -5.3, z: -8.1 });
        sim.move(sim.hero, 0, 0);
        room.update(sim, 1, false);
        for (const card of room.architecture!.parts.filter((s) =>
          ['crypt-west', 'crypt-rear'].includes(s.userData.siteWall),
        ))
          assert.equal(
            (card.material as T.MeshBasicMaterial).opacity,
            1,
            'a far wall must not fade when the actor stands in front of its local plane',
          );
      }
    } finally {
      room.dispose();
      for (const pack of packs.values())
        for (const texture of pack.textures.values()) texture.dispose();
    }
  }
});
