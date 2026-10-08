import type { PreparedRegistration } from '../assets/registration';
import * as T from 'three';
import {
  contract,
  resizeCamera,
  trimmedBounds,
  drawingBufferSize,
  HEADINGS,
  right,
  up,
  outward,
} from '../core/camera';
import { ActorSprite } from './sprite';
import { remapWalkTime } from '../core/locomotion-timing';
import { Animator } from '../core/animation';
import { resolveClip, type Clip, type Frame } from '../assets/schema';
import { tuning } from '../content/gameplay';
import { type PackLease } from '../assets/loader';
import { EventHub } from '../core/events';
import type { Simulation } from '../core/simulation';
import { GamePresentation, type Mode } from './game-scene';
import { defaultLook } from './lighting-profiles';
import { captureArtDiagnostics } from './art-diagnostics';
import { ArtConstructionOverlay } from './art-construction-overlay';
export type { Mode } from './game-scene';
export class Presentation extends GamePresentation {
  captureArtDiagnostics() {
    return captureArtDiagnostics(this);
  }
  readonly artConstruction = new ArtConstructionOverlay(this.registration.coverage);
  get lightingLab() {
    return this.lookRenderer;
  }
  calibration = new T.Group();
  overlay = new T.Group();
  rootMarkers = new T.Group();
  private rootGeometry = new T.CircleGeometry(0.035, 16);
  private rootMaterial = new T.MeshBasicMaterial({
    color: 0x77e4b3,
    depthTest: false,
    depthWrite: false,
  });
  overlayOwned: { dispose: () => void }[] = [];
  labTime = 0;
  labClip = 'walk';
  labHeading: (typeof HEADINGS)[number] = 'd45';
  labPaused = false;
  labSpeed = 1;
  notifyLog: string[] = [];
  labSprite: ActorSprite;
  secondSprite: ActorSprite;
  labAnimator: Animator;
  frameMap = new Map<string, Frame>();
  lastLabOverlay = '';
  labZoom = 2;
  labPanelInset = 330;
  comparisonElevation = contract.elevationDeg;
  labAsset = 'ink-hero-current';
  comparisonMode: 'treatment' | 'timing' = 'treatment';
  private originalClips = new WeakMap<Clip, Clip>();
  override get manifest() {
    return this.packs.get(this.labAsset ?? 'ink-hero-current')!.manifest;
  }
  override get textures() {
    return this.packs.get(this.labAsset ?? 'ink-hero-current')!.textures;
  }
  constructor(
    canvas: HTMLCanvasElement,
    packs: Map<string, PackLease>,
    events: EventHub,
    initialArea: import('../content/world').AreaDefinition,
    registration: PreparedRegistration,
  ) {
    super(canvas, packs, events, initialArea, registration);
    this.scene.add(this.calibration, this.overlay, this.rootMarkers, this.artConstruction.group);
    for (const side of [-1, 1]) {
      const marker = new T.Mesh(this.rootGeometry, this.rootMaterial);
      marker.position.addScaledVector(right, side * 1.2).addScaledVector(outward, 0.03);
      marker.quaternion.copy(this.camera.quaternion);
      marker.renderOrder = 1000;
      this.rootMarkers.add(marker);
    }
    this.rootMarkers.visible = false;
    const manifest = this.manifest,
      textures = this.textures,
      c = this.getClip(this.labClip, this.labHeading, manifest);
    this.labSprite = new ActorSprite('lab-a', manifest, textures, c);
    this.secondSprite = new ActorSprite(
      'lab-b',
      manifest,
      textures,
      this.getClip('sweep', this.labHeading, manifest),
    );
    this.labAnimator = this.labSprite.animator;
    this.scene.add(this.labSprite.mesh, this.secondSprite.mesh);
    this.frameMap = new Map(manifest.frames.map((f) => [f.id, f]));
    this.buildCalibration();
    this.resize();
  }
  buildCalibration() {
    this.calibration.add(new T.GridHelper(14, 14, 0xbfae82, 0x58626b));
    const cube = new T.Mesh(
      new T.BoxGeometry(1, 1, 1),
      new T.MeshStandardMaterial({ color: 0xc8bca4 }),
    );
    cube.position.set(-2, 0.5, -2);
    this.calibration.add(cube);
    const footprint = new T.Mesh(
      new T.RingGeometry(tuning.heroRadius, tuning.heroRadius + 0.035, 32),
      new T.MeshBasicMaterial({ color: 0x77e4b3, depthTest: true }),
    );
    footprint.rotation.x = -Math.PI / 2;
    footprint.position.y = 0.025;
    this.calibration.add(footprint);
    for (const [dir, color] of [
      [new T.Vector3(1, 0, 0), 0xe28176],
      [new T.Vector3(0, 1, 0), 0xa4c47b],
      [new T.Vector3(0, 0, 1), 0x81b1dd],
    ] as const)
      this.calibration.add(new T.ArrowHelper(dir, new T.Vector3(-4, 0, 0), 2, color));
    for (let i = 0; i < 8; i++) {
      const yaw = (i * Math.PI) / 4,
        dir = new T.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
      this.calibration.add(new T.ArrowHelper(dir, new T.Vector3(0, 0.03, 0), 2.5, 0xe4be76));
    }
    for (const [color, x] of [
      [0x808080, -4],
      [0xe9bc67, -3],
      [0x263b4a, -2],
    ] as const) {
      const m = new T.Mesh(
        new T.PlaneGeometry(0.65, 0.65),
        new T.MeshBasicMaterial({ color, toneMapped: false }),
      );
      m.quaternion.copy(this.camera.quaternion);
      m.position.set(x, 2, 1);
      this.calibration.add(m);
    }
  }
  getOriginalLabClip(): Clip {
    const clip = resolveClip(this.manifest, this.labClip, this.labHeading);
    if (this.labAsset !== 'ink-hero-current') return clip;
    let original = this.originalClips.get(clip);
    if (original) return original;
    const heading = Object.keys(this.manifest.asset.clips[this.labClip]!).find(
      (h) => this.manifest.asset.clips[this.labClip]![h as (typeof HEADINGS)[number]] === clip,
    )!;
    const holds = this.registration.animation.clips[`${this.labClip}:${heading}`]?.originalHoldsMs;
    original = holds ? { ...clip, durationsMs: [...holds], notifies: [] } : clip;
    this.originalClips.set(clip, original);
    return original;
  }
  restartLab() {
    this.labAnimator.start(this.getClip(this.labClip, this.labHeading));
    this.labTime = 0;
  }
  selectLabAsset(id: string) {
    if (id === this.labAsset) return;
    const pack = this.packs.get(id);
    if (!pack) throw new Error('lab asset not loaded');
    this.labAsset = id;
    this.labSprite.dispose();
    this.labClip = Object.keys(pack.manifest.asset.clips)[0]!;
    this.labSprite = new ActorSprite(
      'lab-a',
      pack.manifest,
      pack.textures,
      this.getClip(this.labClip, this.labHeading),
    );
    this.labAnimator = this.labSprite.animator;
    this.scene.add(this.labSprite.mesh);
    this.secondSprite.dispose();
    this.secondSprite = new ActorSprite(
      'lab-b',
      pack.manifest,
      pack.textures,
      this.getClip(this.labClip, this.labHeading, pack.manifest),
    );
    this.scene.add(this.secondSprite.mesh);
    this.frameMap = new Map(pack.manifest.frames.map((f) => [f.id, f]));
    this.lastLabOverlay = '';
    this.notifyLog = [];
    if (this.mode === 'animation') this.compareCamera(this.comparisonElevation);
  }

  setMode(mode: Mode) {
    if (mode !== 'lighting')
      this.lookRenderer.setSettings({
        ...defaultLook,
        depthOfField: this.depthOfField,
      });
    if (mode === 'animation' || mode === 'calibration') this.lookRenderer.deactivate();
    this.mode = mode;
    this.lastLabOverlay = '';
    this.compareCamera(contract.elevationDeg);
    this.resize(this.requestedRenderScale);
  }
  get viewSpan() {
    return this.mode === 'animation'
      ? contract.verticalSpan / this.labZoom
      : this.mode === 'calibration'
        ? this.verticalSpan
        : super.viewSpan;
  }
  setLabZoom(zoom: number) {
    if (!Number.isFinite(zoom)) return;
    this.labZoom = Math.max(0.5, Math.min(4, zoom));
    if (this.mode === 'animation') this.resize(this.requestedRenderScale);
  }
  compareCamera(elevation: number) {
    this.comparisonElevation = elevation;
    const a = (contract.azimuthDeg * Math.PI) / 180,
      e = (elevation * Math.PI) / 180,
      target = new T.Vector3();
    if (this.mode === 'animation') {
      // Centre all authored poses together, so cycling drawings cannot move the camera.
      const bounds = this.manifest.frames.map((f) => {
        const b = trimmedBounds(f.registration ?? this.manifest.asset, f.trim),
          y = this.stabilized ? (f.visualOffsetPx?.[1] ?? 0) : 0;
        return {
          ...b,
          top: b.top - y / (f.registration ?? this.manifest.asset).density,
          bottom: b.bottom - y / (f.registration ?? this.manifest.asset).density,
        };
      });
      const center =
        (Math.max(...bounds.map((b) => b.top)) + Math.min(...bounds.map((b) => b.bottom))) / 2;
      target.addScaledVector(up, center);
      // Use the open space to the left of the controls rather than hiding the reference.
      const height = this.canvas.clientHeight,
        width = this.canvas.clientWidth;
      if (height > 0)
        target.addScaledVector(
          right,
          (Math.min(this.labPanelInset, width * 0.4) * this.viewSpan) / (2 * height),
        );
    }
    this.camera.position
      .copy(target)
      .add(
        new T.Vector3(
          Math.sin(a) * Math.cos(e) * 30,
          Math.sin(e) * 30,
          Math.cos(a) * Math.cos(e) * 30,
        ),
      );
    this.camera.lookAt(target);
    this.camera.updateMatrixWorld();
  }
  override update(sim: Simulation, alpha: number, ms: number, aim: { x: number; z: number }) {
    const lab = this.mode === 'animation' || this.mode === 'calibration';
    this.rootMarkers.visible = this.mode === 'animation' && this.labAsset === 'ink-hero-current';
    this.calibration.visible =
      lab && !(this.mode === 'animation' && this.labAsset === 'ink-hero-current');
    this.labSprite.mesh.visible = this.mode === 'animation';
    this.secondSprite.mesh.visible = this.mode === 'animation';
    this.overlay.visible = this.mode === 'animation' && this.debug;
    if (!lab) {
      super.update(sim, alpha, ms, aim);
      return;
    }
    this.artConstruction.group.visible = false;
    this.room.visible = false;
    this.flare.visible = false;
    this.slash.visible = false;
    this.aim.visible = false;
    this.renderer.setClearColor(this.background === 'light' ? 0xd1c9b4 : 0x151923);
    const c = this.getClip(this.labClip, this.labHeading);
    if (this.labAnimator.clip !== c) {
      const previous = this.labAnimator.clip,
        time = remapWalkTime(previous, c, this.labAnimator.time);
      this.labAnimator.start(c);
      this.labAnimator.seek(time);
      this.labTime = time;
    }
    if (!this.labPaused) {
      const events = this.labAnimator.advance(ms * this.labSpeed);
      this.notifyLog.push(...events.map((e) => e.key + ' ' + e.kind));
      this.notifyLog = this.notifyLog.slice(-10);
      this.labTime = this.labAnimator.time;
    }
    const position =
      this.mode === 'animation'
        ? this.labAsset === 'ink-hero-current'
          ? new T.Vector3().addScaledVector(right, -1.2)
          : new T.Vector3(-1.2, 0, 0)
        : new T.Vector3(0, 0, 0);
    const compareHero = this.labAsset === 'ink-hero-current',
      blendHero = compareHero;
    this.labSprite.rigidSword = this.rigidSword;
    this.labSprite.stabilized = compareHero ? this.stabilized : true;
    this.secondSprite.stabilized = !compareHero;
    const f = this.labSprite.showAnimation(
      position,
      this.camera,
      blendHero ? this.animationTreatment : 'original',
      this.animationFlow,
    );
    if (compareHero) {
      const reference = this.comparisonMode === 'timing' ? this.getOriginalLabClip() : c;
      if (this.secondSprite.animator.clip !== reference)
        this.secondSprite.animator.start(reference);
      this.secondSprite.animator.seek(this.labAnimator.time);
    } else this.secondSprite.animator.advance(ms * 0.7);
    this.secondSprite.show(
      this.secondSprite.animator.frame,
      compareHero ? new T.Vector3().addScaledVector(right, 1.2) : new T.Vector3(1.2, 0, 0),
      this.camera,
    );
    this.secondSprite.material.color.set(compareHero ? 0xffffff : 0x98a8c3);
    if (this.debug && this.lastLabOverlay !== f.id) {
      this.drawOverlay(f, position);
      this.lastLabOverlay = f.id;
    }
    this.renderer.render(this.scene, this.camera);
  }
  protected override renderFrame(sim: Simulation, ms: number) {
    this.artConstruction.update(
      sim.areaDefinition,
      this.inkRoom,
      sim.generation,
      this.mode === 'occlusion' && this.debug,
    );
    super.renderFrame(sim, ms);
  }
  drawOverlay(f: Frame, foot: T.Vector3) {
    this.overlay.clear();
    this.overlayOwned.forEach((v) => v.dispose());
    this.overlayOwned = [];
    const asset = f.registration ?? this.manifest.asset,
      lines = (bounds: number[], color: number) => {
        const [x, y, w, h] = bounds as [number, number, number, number],
          ax = asset.anchor[0],
          ay = asset.anchor[1],
          d = asset.density;
        const corners = [
          [x, y],
          [x + w, y],
          [x + w, y + h],
          [x, y + h],
          [x, y],
        ];
        const pts = corners.map(([px, py]) =>
          foot
            .clone()
            .addScaledVector(right, (px! - ax) / d)
            .addScaledVector(up, (ay - py!) / d)
            .addScaledVector(outward, 0.01),
        );
        const geo = new T.BufferGeometry().setFromPoints(pts),
          mat = new T.LineBasicMaterial({ color, depthTest: false });
        this.overlay.add(new T.Line(geo, mat));
        this.overlayOwned.push(geo, mat);
      };
    lines([0, 0, ...asset.canvas], 0x78cfe1);
    const offset = this.labSprite.stabilized ? (f.visualOffsetPx ?? [0, 0]) : [0, 0];
    lines([f.trim[0] + offset[0]!, f.trim[1] + offset[1]!, f.trim[2], f.trim[3]], 0xe9bb75);
    for (const [name, p] of Object.entries({
      foot: asset.anchor,
      ...f.attachments,
    })) {
      const pos = foot
        .clone()
        .addScaledVector(
          right,
          (p[0]! - asset.anchor[0] + (name === 'foot' ? 0 : offset[0]!)) / asset.density,
        )
        .addScaledVector(
          up,
          (asset.anchor[1] - p[1]! - (name === 'foot' ? 0 : offset[1]!)) / asset.density,
        )
        .addScaledVector(outward, 0.03);
      const g = new T.CircleGeometry(0.035, 16),
        m = new T.MeshBasicMaterial({
          color: name === 'foot' ? 0x77e4b3 : 0xffcc51,
          depthTest: false,
        }),
        marker = new T.Mesh(g, m);
      marker.position.copy(pos);
      marker.quaternion.copy(this.camera.quaternion);
      this.overlay.add(marker);
      this.overlayOwned.push(g, m);
    }
  }
  override resize(scale = contract.renderScale) {
    super.resize(scale);
    if (this.mode === 'animation') this.compareCamera(this.comparisonElevation);
  }
  override async warm() {
    await this.lightingLab.prepare();
    this.labSprite.show(this.labSprite.animator.frame, new T.Vector3(), this.camera);
    this.secondSprite.show(this.secondSprite.animator.frame, new T.Vector3(1.2, 0, 0), this.camera);
    await super.warm();
  }
  override stats() {
    return {
      ...super.stats(),
      labZoom: this.labZoom,
      lightingLab: this.lightingLab?.stats(),
    };
  }
  override dispose() {
    if (this.disposed) return;
    this.artConstruction.dispose();
    this.rootGeometry.dispose();
    this.rootMaterial.dispose();
    this.labSprite.dispose();
    this.secondSprite.dispose();
    this.overlayOwned.forEach((v) => v.dispose());
    this.calibration.traverse((o) => {
      if (o instanceof T.Mesh || o instanceof T.LineSegments || o instanceof T.Line) {
        o.geometry.dispose();
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.dispose();
      }
    });
    super.dispose();
  }
}
