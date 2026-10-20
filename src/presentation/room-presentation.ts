import { boundsCorners } from '../content/polygon';
import { cleanupAll, cleanupAfterFailure, DisposalScope } from '../assets/cleanup';
import { artworkFloorLayout } from '../content/floor-layout';
import * as T from 'three';
import { InkRoom } from './ink-room';
import {
  SceneSurround,
  groundFootprintGeometry,
  groundRimGeometry,
  insetGround,
  fadeGroundRim,
} from './scene-surround';
import { floorUV } from '../content/world-visuals';
import { heightAt } from '../content/world';
import type { AreaDefinition } from '../content/world';
import type { WorldVisualDefinition } from '../content/world-visuals';
import type { AssetPack } from '../assets/loader';
import type { PreparedRegistration } from '../assets/registration';
const DEPTH_STAGE = { ground: -2, groundGrid: -1, world: 0 } as const;
export class RoomPresentation {
  readonly room = new T.Group();
  readonly surround: SceneSurround;
  inkRoom: InkRoom | undefined;
  private roomOwned = new DisposalScope();
  private building = false;
  constructor(
    private packs: ReadonlyMap<string, AssetPack>,
    private camera: T.OrthographicCamera,
    private shadowTexture: T.CanvasTexture,
    private registration: PreparedRegistration,
  ) {
    this.surround = new SceneSurround(packs);
  }
  buildRoom(area: AreaDefinition, art: WorldVisualDefinition | undefined) {
    if (this.building) throw new Error('Room construction in progress');
    if (!art && (area.props.length || area.exits.length))
      throw new Error('Scenery and exits require an authored visual definition');
    const resources = this.roomOwned;
    this.building = true;
    try {
      this.buildOwnedRoom(area, art, resources);
      if (this.roomOwned !== resources) throw new Error('Room construction retired');
    } catch (error) {
      cleanupAfterFailure(error, () =>
        cleanupAll([() => this.disposeScenery(), () => this.disposeResources()]),
      );
    } finally {
      this.building = false;
    }
  }
  private buildOwnedRoom(
    area: AreaDefinition,
    art: WorldVisualDefinition | undefined,
    resources: DisposalScope,
  ) {
    const artwork =
      art?.editorFloor?.layout === 'artwork'
        ? artworkFloorLayout(art.editorFloor.width, art.editorFloor.depth)
        : undefined;
    const surround = artwork ? undefined : art?.surround;
    this.surround.build(surround);
    const footprint = artwork
      ? artwork.corners
      : art?.editorFloor
        ? boundsCorners(area.bounds)
        : surround
          ? art?.interior
            ? boundsCorners(art.interior)
            : surround.ground
          : undefined;
    if (art)
      this.inkRoom = new InkRoom(
        area,
        this.packs,
        this.room,
        this.camera,
        this.shadowTexture,
        this.registration,
        art,
      );
    const bounds = area.bounds,
      surface = area.surface,
      steps = surface.kind === 'stairs' ? (surface.steps ?? 3) : 3,
      stairWidth = surface.kind === 'stairs' ? (surface.stairWidth ?? 3.2) : 3.2,
      axis = (min: number, max: number, name: 'x' | 'z') => {
        const values = [min, max];
        for (let n = min + 2; n < max; n += 2) values.push(n);
        if (surface.kind !== 'flat' && surface.axis === name) {
          values.push(surface.start, surface.end);
          if (surface.kind === 'stairs')
            for (let i = 1; i < steps; i++)
              values.push(surface.start + ((surface.end - surface.start) * i) / steps);
        }
        if (surface.kind === 'stairs' && surface.terraceBounds) {
          values.push(
            ...(name === 'x'
              ? [surface.terraceBounds.minX, surface.terraceBounds.maxX]
              : [surface.terraceBounds.minZ, surface.terraceBounds.maxZ]),
          );
          if (name === (surface.axis === 'x' ? 'z' : 'x'))
            values.push(-stairWidth / 2, stairWidth / 2);
        }
        return [...new Set(values)].sort((a, b) => a - b);
      };
    const xs = footprint ? [] : axis(bounds.minX - 72, bounds.maxX + 72, 'x'),
      zs = footprint ? [] : axis(bounds.minZ - 72, bounds.maxZ + 72, 'z'),
      vertices: number[] = [],
      indices: number[] = [];
    const quad = (a: number[], b: number[], c: number[], d: number[]) => {
      const first = vertices.length / 3;
      vertices.push(...a, ...b, ...c, ...d);
      indices.push(first, first + 2, first + 1, first + 1, first + 2, first + 3);
    };
    for (let zi = 0; zi < zs.length - 1; zi++)
      for (let xi = 0; xi < xs.length - 1; xi++) {
        const x = xs[xi]!,
          nx = xs[xi + 1]!,
          z = zs[zi]!,
          nz = zs[zi + 1]!,
          stepped = surface.kind === 'stairs',
          middle = heightAt(area, (x + nx) / 2, (z + nz) / 2) - 0.01;
        const y = (px: number, pz: number) =>
          this.inkRoom && stepped
            ? surface.startHeight - 0.01
            : stepped
              ? middle
              : heightAt(area, px, pz) - 0.01;
        quad([x, y(x, z), z], [nx, y(nx, z), z], [x, y(x, nz), nz], [nx, y(nx, nz), nz]);
        if (!this.inkRoom && stepped && xi > 0) {
          const before = heightAt(area, (xs[xi - 1]! + x) / 2, (z + nz) / 2) - 0.01;
          if (Math.abs(before - middle) > 1e-6)
            quad([x, before, nz], [x, before, z], [x, middle, nz], [x, middle, z]);
        }
        if (!this.inkRoom && stepped && zi > 0) {
          const before = heightAt(area, (x + nx) / 2, (zs[zi - 1]! + z) / 2) - 0.01;
          if (Math.abs(before - middle) > 1e-6)
            quad([x, before, z], [nx, before, z], [x, middle, z], [nx, middle, z]);
        }
      }
    const floorGeometry = resources.own(
      footprint
        ? groundFootprintGeometry(
            art?.interior || art?.editorFloor ? footprint : insetGround(footprint, 1.4),
            (x, z) =>
              surface.kind === 'stairs' ? surface.startHeight - 0.01 : heightAt(area, x, z) - 0.01,
          )
        : new T.BufferGeometry(),
    );
    if (!footprint) {
      floorGeometry.setAttribute('position', new T.Float32BufferAttribute(vertices, 3));
      floorGeometry.setIndex(indices);
      floorGeometry.computeVertexNormals();
      floorGeometry.setAttribute(
        'uv',
        new T.Float32BufferAttribute(
          vertices.flatMap((_, i) =>
            i % 3 === 0 ? [...floorUV(vertices[i]!, vertices[i + 2]!)] : [],
          ),
          2,
        ),
      );
    }
    if (artwork) {
      const positions = floorGeometry.getAttribute('position');
      // Authored image coordinates start at the top left; texture UVs start at the bottom left.
      const uvs = Array.from({ length: positions.count }, (_, i) => {
        const [u, v] = artwork.uv({ x: positions.getX(i), z: positions.getZ(i) });
        return [u, 1 - v];
      }).flat();
      floorGeometry.setAttribute('uv', new T.Float32BufferAttribute(uvs, 2));
    }
    let outsideMap: T.Texture | undefined;
    if (surround && art?.interior) {
      const pack = this.packs.get('ink-stage-earth')!,
        map = resources.own(pack.textures.get(pack.manifest.frames[0]!.page)!.clone());
      map.wrapS = map.wrapT = T.RepeatWrapping;
      map.needsUpdate = true;
      outsideMap = map;
      const outside = new T.Mesh(
        resources.own(
          groundFootprintGeometry(
            insetGround(surround.ground, 1.4),
            (x, z) => heightAt(area, x, z) - 0.02,
          ),
        ),
        resources.own(
          new T.MeshBasicMaterial({
            map,
            color: 0xffffff,
            depthWrite: false,
            toneMapped: false,
          }),
        ),
      );
      outside.renderOrder = DEPTH_STAGE.ground - 0.1;
      outside.userData.surfaceRole = 'ground';
      this.room.add(outside);
    }
    if (surround) {
      const rimMaterial = resources.own(
        art?.interior
          ? new T.MeshBasicMaterial({
              map: outsideMap,
              color: 0xffffff,
              depthWrite: false,
              toneMapped: false,
            })
          : this.inkRoom!.floorMaterial(),
      );
      fadeGroundRim(rimMaterial);
      const rim = new T.Mesh(
        resources.own(
          groundRimGeometry(
            surround.ground,
            (x, z) =>
              surface.kind === 'stairs'
                ? surface.startHeight - 0.01
                : heightAt(area, x, z) - (art?.interior ? 0.02 : 0.01),
            1.4,
          ),
        ),
        rimMaterial,
      );
      rim.renderOrder = DEPTH_STAGE.ground + 0.01;
      rim.userData.stableReveal = true;
      rim.userData.decorative = true;
      this.room.add(rim);
    }
    const floor = new T.Mesh(
      floorGeometry,
      resources.own(
        this.inkRoom
          ? this.inkRoom.floorMaterial()
          : new T.MeshStandardMaterial({
              color: area.floorColor,
              roughness: 1,
              depthTest: true,
              depthWrite: false,
            }),
      ),
    );
    floor.renderOrder = DEPTH_STAGE.ground;
    this.room.add(floor);
    if (this.inkRoom) {
      this.inkRoom.build();
      return;
    }
    const gridPoints: T.Vector3[] = [],
      gx = axis(bounds.minX, bounds.maxX, 'x'),
      gz = axis(bounds.minZ, bounds.maxZ, 'z');
    for (const x of gx)
      for (let i = 1; i < gz.length; i++)
        gridPoints.push(
          new T.Vector3(x, heightAt(area, x, gz[i - 1]!) + 0.012, gz[i - 1]),
          new T.Vector3(x, heightAt(area, x, gz[i]!) + 0.012, gz[i]),
        );
    for (const z of gz)
      for (let i = 1; i < gx.length; i++)
        gridPoints.push(
          new T.Vector3(gx[i - 1], heightAt(area, gx[i - 1]!, z) + 0.012, z),
          new T.Vector3(gx[i], heightAt(area, gx[i]!, z) + 0.012, z),
        );
    const gridGeometry = resources.own(new T.BufferGeometry());
    gridGeometry.setFromPoints(gridPoints);
    const gridMaterial = resources.own(
      new T.LineBasicMaterial({
        color: 0x4c6169,
        depthWrite: false,
      }),
    );
    const grid = new T.LineSegments(gridGeometry, gridMaterial);
    grid.renderOrder = DEPTH_STAGE.groundGrid;
    this.room.add(grid);
  }

  disposeScenery() {
    const inkRoom = this.inkRoom;
    this.inkRoom = undefined;
    cleanupAll([() => this.surround.dispose(), () => inkRoom?.dispose()]);
  }
  disposeResources() {
    const owned = this.roomOwned;
    this.roomOwned = new DisposalScope();
    cleanupAll([() => this.room.clear(), () => owned.dispose()]);
  }
}
