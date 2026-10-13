import { brushMask } from './mask-contours';
import { GroundProfileSchema, restoreGroundProfile } from '../content/ground-profile';
import * as T from 'three';
import { groundPoint } from '../core/camera';
import { artworkFloorLayout } from '../content/floor-layout';
import type { GroundRegion, MaskShape } from '../content/ground-interaction';
import {
  parseSceneDocument,
  type SceneDocument,
  type SceneSnapshot,
} from '../content/scene-document';
import type { Manifest } from '../assets/schema';
import type { EditorView } from './view';
const ns = 'http://www.w3.org/2000/svg';
type UV = [number, number];
type Candidate = {
  name: string;
  box: [number, number, number, number];
  score: number;
  included: boolean;
  mask?: MaskShape[];
};
type Host = {
  document: () => SceneSnapshot;
  view: () => EditorView;
  manifest: () => Manifest | undefined;
  change: (work: (d: SceneDocument) => void, committed?: () => void) => Promise<void>;
  status: (s: string, error?: boolean) => void;
  request: (
    selection: unknown,
    signal: AbortSignal,
  ) => Promise<{
    mask: MaskShape[];
    candidates?: Omit<Candidate, 'included' | 'mask'>[];
    device: string;
    milliseconds: number;
  }>;
};
export class GroundAuthoring {
  private panel: HTMLElement;
  private svg: SVGSVGElement;
  private selected = '';
  private points: UV[] = [];
  private prompts: { uv: UV; include: boolean }[] = [];
  private box?: [number, number, number, number];
  private proposal?: MaskShape[];
  private candidates: Candidate[] = [];
  private batchDocument?: SceneSnapshot;
  private gesture?: UV[];
  private pointer?: number;
  private abort?: AbortController;
  private request = 0;
  private lifetime = new AbortController();
  private previous?: SceneSnapshot;
  private signature = '';
  private mode = 'off';
  private vertex?: {
    kind: 'footprint' | 'mask' | 'hole' | 'anchor' | 'boundary';
    index: number;
    shape?: number;
    hole?: number;
  };
  private overlays = { blockers: false, masks: false, depth: false };
  constructor(
    private canvas: HTMLCanvasElement,
    private host: Host,
  ) {
    this.panel = document.createElement('details');
    this.panel.id = 'ground-interaction-section';
    this.panel.innerHTML = `<summary>Ground interaction</summary><p>Trace ground footprints separately from scenery silhouettes.</p><label>Region<select id="ground-region"><option value="">New region</option></select></label><label>Name<input id="ground-region-name" maxlength="80" value="Ground region"></label><label>Task<select id="ground-task"><option value="off">Select / edit vertices</option><option value="footprint">Block movement polygon</option><option value="mask">Occlusion polygon</option><option value="ai-box">AI box selection</option><option value="ai-point">AI include / exclude clicks</option><option value="brush-add">Add to mask brush</option><option value="brush-erase">Erase mask brush</option><option value="anchor">Depth anchor</option><option value="boundary">Depth boundary</option></select></label><p id="ground-task-help">Choose a task, then work on the canvas. Shift-click excludes from AI selection.</p><label>Brush radius (source pixels)<input id="ground-brush-radius" type="number" min="1" max="256" value="12"></label><div class="ground-actions"><button id="ground-finish">Finish polygon / boundary</button><button id="ground-refine">Run AI selection</button><button id="ground-accept">Accept mask</button><button id="ground-cancel">Cancel selection</button><button id="ground-duplicate">Duplicate region</button><button id="ground-delete">Delete region</button><button id="ground-clear">Clear all ground interaction</button></div><fieldset><legend>Ground overlays</legend><label><input id="ground-show-blockers" type="checkbox"> Blocking footprints</label><label><input id="ground-show-masks" type="checkbox"> Occlusion masks</label><label><input id="ground-show-depth" type="checkbox"> Depth anchors and boundaries</label></fieldset><p id="ground-ai-state" role="status">Local selection: run npm run segmentation:setup once.</p>`;
    document.getElementById('scene-panel')!.append(this.panel);
    const profiles = document.createElement('fieldset');
    profiles.innerHTML = `<legend>Saved artwork interaction profiles</legend><button id="ground-load-profiles">Find saved profiles</button><label>Saved revision<select id="ground-profile"><option value="">Find saved profiles first</option></select></label><label><input id="ground-profile-review" type="checkbox"> Reassign to changed artwork and review alignment</label><button id="ground-restore-profile">Restore selected profile</button><p>Saving a scene archives an independent revision. Scene deletion and asset processing leave these revisions intact. Restoring replaces this scene’s interaction data in one undoable edit.</p>`;
    this.panel.append(profiles);
    profiles.querySelector<HTMLButtonElement>('#ground-load-profiles')!.onclick = () =>
      void this.loadProfiles().catch((e) => this.host.status(String(e), true));
    profiles.querySelector<HTMLButtonElement>('#ground-restore-profile')!.onclick = () =>
      void this.restoreProfile().catch((e) => this.host.status(String(e), true));
    const batch = document.createElement('fieldset');
    batch.innerHTML = `<legend>Automatic scenery proposals</legend><label>Find objects<input id="ground-find-text" value="pine tree. dead tree. stone wall. large rock." maxlength="300"></label><button id="ground-find">Find scenery</button><label>Review proposal<select id="ground-candidate"><option value="">Find scenery first</option></select></label><label><input id="ground-candidate-included" type="checkbox" checked> Include this proposal</label><div class="ground-actions"><button id="ground-prepare">Prepare included masks</button><button id="ground-accept-batch">Accept prepared masks</button></div><p>AI proposes silhouettes only. Review collision footprints and depth separately. Nothing is saved until accepted.</p>`;
    this.panel.querySelector('#ground-ai-state')!.before(batch);
    this.svg = document.createElementNS(ns, 'svg');
    this.svg.classList.add('ground-overlay');
    this.svg.setAttribute('aria-hidden', 'true');
    canvas.parentElement!.append(this.svg);
    const $ = <E extends HTMLElement>(id: string) => this.panel.querySelector<E>('#' + id)!;
    $('ground-find').onclick = () => void this.findScenery();
    $('ground-prepare').onclick = () => void this.prepareScenery();
    $('ground-accept-batch').onclick = () => void this.acceptScenery();
    $('ground-candidate').onchange = () => {
      this.cancel();
      this.reviewCandidate();
    };
    $('ground-candidate-included').onchange = () => {
      const candidate = this.candidates[Number($<HTMLSelectElement>('ground-candidate').value)];
      if (candidate) candidate.included = $<HTMLInputElement>('ground-candidate-included').checked;
    };
    $('ground-region').onchange = () => {
      this.selected = $<HTMLSelectElement>('ground-region').value;
      this.cancel();
      this.updateName();
    };
    $('ground-region-name').onchange = () => {
      if (this.selected)
        this.commit((r) => {
          r.name = $<HTMLInputElement>('ground-region-name').value;
        });
    };
    $('ground-task').onchange = () => {
      const next = $<HTMLSelectElement>('ground-task').value;
      const refinement = ['ai-point', 'brush-add', 'brush-erase'].includes(next)
        ? { proposal: this.proposal, box: this.box, prompts: this.prompts }
        : undefined;
      this.cancel();
      if (refinement) Object.assign(this, refinement);
      this.mode = next;
      this.host.status(
        'Ground interaction: ' +
          $<HTMLSelectElement>('ground-task').selectedOptions[0]!.textContent,
      );
    };
    $('ground-finish').onclick = () => this.finish();
    $('ground-refine').onclick = () =>
      void this.infer().catch((e) => this.host.status(String(e), true));
    $('ground-accept').onclick = () => {
      if (this.proposal) {
        const mask = this.proposal;
        this.commit(
          (r) => {
            r.mask = mask;
          },
          () => {
            if (this.proposal === mask) this.cancel();
          },
        );
      }
    };
    $('ground-cancel').onclick = () => this.cancel(true);
    $('ground-delete').onclick = () =>
      void host
        .change((d) => {
          if (d.groundInteraction)
            d.groundInteraction.regions = d.groundInteraction.regions.filter(
              (r) => r.id !== this.selected,
            );
        })
        .then(() => {
          this.selected = '';
          this.cancel();
        });
    $('ground-duplicate').onclick = () =>
      void host.change((d) => {
        const r = d.groundInteraction?.regions.find((v) => v.id === this.selected);
        if (r) {
          const copy = structuredClone(r);
          copy.id = 'region-' + crypto.randomUUID();
          copy.name += ' copy';
          d.groundInteraction!.regions.push(copy);
          this.selected = copy.id;
        }
      });
    $('ground-clear').onclick = () =>
      void host
        .change((d) => {
          delete d.groundInteraction;
        })
        .then(() => {
          this.selected = '';
          this.cancel();
        });
    for (const key of ['blockers', 'masks', 'depth'] as const)
      $('ground-show-' + key).onchange = () => {
        this.overlays[key] = $<HTMLInputElement>('ground-show-' + key).checked;
        this.signature = '';
      };
    const signal = this.lifetime.signal;
    canvas.addEventListener('pointerdown', (e) => this.down(e), { capture: true, signal });
    canvas.addEventListener(
      'pointermove',
      (e) => {
        if (this.gesture && this.pointer === e.pointerId) {
          const uv = this.uv(e);
          if (uv) {
            if (this.mode === 'ai-box') this.gesture[1] = uv;
            else this.gesture.push(uv);
            this.signature = '';
          }
          e.stopImmediatePropagation();
        }
      },
      { capture: true, signal },
    );
    canvas.addEventListener('pointerup', (e) => this.up(e), { capture: true, signal });
    for (const type of ['pointercancel', 'lostpointercapture'] as const)
      canvas.addEventListener(
        type,
        (e) => {
          if (this.pointer !== e.pointerId) return;
          this.cancel();
          e.preventDefault();
          e.stopImmediatePropagation();
        },
        { capture: true, signal },
      );
    document.addEventListener(
      'keydown',
      (e) => {
        if (
          e.key === 'Escape' &&
          (this.points.length || this.proposal || this.gesture || this.abort)
        ) {
          this.cancel();
          e.preventDefault();
          e.stopImmediatePropagation();
        }
      },
      { capture: true, signal },
    );
  }
  private region() {
    return this.host.document().groundInteraction?.regions.find((r) => r.id === this.selected);
  }
  private updateName() {
    const r = this.region();
    this.panel.querySelector<HTMLInputElement>('#ground-region-name')!.value =
      r?.name ?? 'Ground region';
  }
  private uv(e: PointerEvent): UV | undefined {
    const p = this.host.view().presentation,
      d = this.host.document();
    if (!p || d.floor.layout !== 'artwork') return;
    const world = groundPoint(p.camera, e.clientX, e.clientY, this.canvas.getBoundingClientRect());
    if (!world) return;
    const [u, v] = artworkFloorLayout(d.floor.width, d.floor.depth).uv(world);
    return [Math.max(0, Math.min(1, u)), Math.max(0, Math.min(1, v))];
  }
  private down(e: PointerEvent) {
    if (!this.panel.hasAttribute('open') || e.button !== 0) return;
    if (this.pointer !== undefined) {
      e.preventDefault();
      e.stopImmediatePropagation();
      return;
    }
    const uv = this.uv(e);
    if (!uv) return;
    if (this.mode === 'off') {
      const d = this.host.document(),
        layout = artworkFloorLayout(d.floor.width, d.floor.depth),
        p = this.host.view().presentation!;
      const rect = this.canvas.getBoundingClientRect();
      let closest = 10;
      for (const region of d.groundInteraction?.regions ?? []) {
        const consider = (
          candidate: readonly [number, number],
          vertex: NonNullable<GroundAuthoring['vertex']>,
        ) => {
          const world = layout.world(candidate),
            q = new T.Vector3(world.x, 0, world.z).project(p.camera),
            distance = Math.hypot(
              ((q.x + 1) * rect.width) / 2 - (e.clientX - rect.left),
              ((1 - q.y) * rect.height) / 2 - (e.clientY - rect.top),
            );
          if (distance < closest) {
            closest = distance;
            this.selected = region.id;
            this.vertex = vertex;
          }
        };
        if (this.overlays.blockers)
          region.footprint?.forEach((p, index) =>
            consider(layout.uv(p), { kind: 'footprint', index }),
          );
        if (this.overlays.masks)
          region.mask?.forEach((shape, si) => {
            shape.outer.forEach((p, index) => consider(p, { kind: 'mask', index, shape: si }));
            shape.holes.forEach((hole, hi) =>
              hole.forEach((p, index) => consider(p, { kind: 'hole', index, shape: si, hole: hi })),
            );
          });
        if (this.overlays.depth && region.depth?.kind === 'anchor')
          consider(layout.uv(region.depth.point), { kind: 'anchor', index: 0 });
        else if (this.overlays.depth && region.depth?.kind === 'boundary')
          region.depth.points.forEach((p, index) =>
            consider(layout.uv(p), { kind: 'boundary', index }),
          );
      }
      if (!this.vertex) return;
      this.gesture = [uv];
      this.pointer = e.pointerId;
      this.canvas.setPointerCapture(e.pointerId);
      this.panel.querySelector<HTMLSelectElement>('#ground-region')!.value = this.selected;
      this.updateName();
      e.preventDefault();
      e.stopImmediatePropagation();
      return;
    }
    e.preventDefault();
    e.stopImmediatePropagation();
    this.canvas.focus();
    if (this.mode === 'ai-box' || this.mode.startsWith('brush')) {
      this.gesture = [uv];
      this.pointer = e.pointerId;
      this.canvas.setPointerCapture(e.pointerId);
    } else if (this.mode === 'anchor') {
      const d = this.host.document(),
        world = artworkFloorLayout(d.floor.width, d.floor.depth).world(uv);
      this.commit((r) => {
        r.depth = { kind: 'anchor', point: world };
      });
    } else if (this.mode === 'ai-point') {
      this.prompts.push({ uv, include: !e.shiftKey });
      void this.infer().catch((e) => this.host.status(String(e), true));
    } else this.points.push(uv);
    this.signature = '';
  }
  private up(e: PointerEvent) {
    if (!this.gesture || this.pointer !== e.pointerId) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const points = this.gesture;
    const final = this.uv(e);
    if (final) {
      if (this.mode === 'ai-box') points[1] = final;
      else points.push(final);
    }
    this.gesture = undefined;
    this.pointer = undefined;
    if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    if (this.vertex) {
      const vertex = this.vertex,
        uv = points.at(-1)!,
        d = this.host.document(),
        world = artworkFloorLayout(d.floor.width, d.floor.depth).world(uv);
      this.vertex = undefined;
      this.commit((r) => {
        if (vertex.kind === 'footprint') r.footprint![vertex.index] = world;
        else if (vertex.kind === 'anchor') r.depth = { kind: 'anchor', point: world };
        else if (vertex.kind === 'boundary' && r.depth?.kind === 'boundary')
          r.depth.points[vertex.index] = world;
        else if (vertex.kind === 'mask') r.mask![vertex.shape!]!.outer[vertex.index] = uv;
        else if (vertex.kind === 'hole')
          r.mask![vertex.shape!]!.holes[vertex.hole!]![vertex.index] = uv;
      });
      return;
    }
    if (this.mode === 'ai-box') {
      const a = points[0]!,
        b = points.at(-1)!;
      if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.001) return;
      this.box = [
        Math.min(a[0], b[0]),
        Math.min(a[1], b[1]),
        Math.max(a[0], b[0]),
        Math.max(a[1], b[1]),
      ];
      this.prompts = [];
      void this.infer().catch((e) => this.host.status(String(e), true));
    } else {
      const mask =
        this.proposal ??
        parseSceneDocument(this.host.document()).groundInteraction?.regions.find(
          (r) => r.id === this.selected,
        )?.mask;
      if (!mask) {
        this.host.status('Select or draw a mask before using the brush.', true);
        return;
      }
      const dimensions = this.host.manifest()?.asset.canvas;
      if (!dimensions) return;
      try {
        const result = brushMask(
          mask,
          dimensions,
          points,
          Number(this.panel.querySelector<HTMLInputElement>('#ground-brush-radius')!.value),
          this.mode === 'brush-erase',
        );
        if (this.proposal) {
          const candidate = this.candidates.find((c) => c.mask === this.proposal);
          if (candidate) candidate.mask = result;
          this.proposal = result;
          this.signature = '';
        } else
          this.commit((r) => {
            r.mask = result;
          });
      } catch (error) {
        this.host.status(String(error), true);
      }
    }
  }
  private commit(work: (r: GroundRegion) => void, committed?: () => void) {
    const name = this.panel.querySelector<HTMLInputElement>('#ground-region-name')!.value;
    const requested = this.selected;
    let selected = requested;
    void this.host
      .change(
        (d) => {
          if (!d.groundInteraction) {
            const m = this.host.manifest();
            if (!m) throw new Error('Ground artwork is not ready');
            const frame = m.asset.clips[d.floor.clip ?? 'still']?.d45?.frames[0];
            if (!frame) throw new Error('Ground needs a still frame');
            d.groundInteraction = {
              asset: m.asset.id,
              frame,
              hash: m.pages.find((p) => p.id === m.frames.find((f) => f.id === frame)?.page)!.hash,
              dimensions: [...m.asset.canvas],
              regions: [],
              destinations: [],
            };
          }
          let r = d.groundInteraction.regions.find((v) => v.id === requested);
          if (!r) {
            r = { id: 'region-' + crypto.randomUUID(), name };
            selected = r.id;
            d.groundInteraction.regions.push(r);
          }
          work(r);
          if (r.mask?.length && !r.depth) {
            const [u, v] = r.mask[0]!.outer.reduce(
              ([x, y], p) => [x + p[0], Math.max(y, p[1])] as UV,
              [0, 0] as UV,
            );
            r.depth = {
              kind: 'anchor',
              point: artworkFloorLayout(d.floor.width, d.floor.depth).world([
                u / r.mask[0]!.outer.length,
                v,
              ]),
            };
          }
        },
        () => {
          this.selected = selected;
          committed?.();
        },
      )
      .catch((e) => this.host.status(String(e), true));
  }
  private finish() {
    const d = this.host.document(),
      layout = artworkFloorLayout(d.floor.width, d.floor.depth),
      original = this.points,
      points = [...original],
      accepted = () => {
        if (this.points === original) this.points.splice(0, points.length);
        this.signature = '';
      };
    if (this.mode === 'footprint' && points.length >= 3)
      this.commit((r) => {
        r.footprint = points.map((p) => layout.world(p));
      }, accepted);
    else if (this.mode === 'mask' && points.length >= 3)
      this.commit((r) => {
        r.mask = [...(r.mask ?? []), { outer: points, holes: [] }];
      }, accepted);
    else if (this.mode === 'boundary' && points.length >= 2)
      this.commit((r) => {
        r.depth = {
          kind: 'boundary',
          points: points.sort((a, b) => a[0] - b[0]).map((p) => layout.world(p)),
        };
      }, accepted);
    else {
      this.host.status('Add enough points for the selected task.', true);
      return;
    }
  }
  private async infer() {
    this.abort?.abort();
    const abort = new AbortController();
    this.abort = abort;
    const request = ++this.request,
      d = this.host.document(),
      m = this.host.manifest();
    if (!m) return;
    const frame = m.asset.clips[d.floor.clip ?? 'still']?.d45?.frames[0];
    const focus =
      this.box ??
      (this.prompts.length
        ? [
            this.prompts[0]!.uv[0] - 0.1,
            this.prompts[0]!.uv[1] - 0.1,
            this.prompts[0]!.uv[0] + 0.1,
            this.prompts[0]!.uv[1] + 0.1,
          ]
        : undefined);
    if (!focus) {
      this.host.status('Draw an AI box or add a selection point first.', true);
      this.abort = undefined;
      return;
    }
    const crop = focus
      ? [
          Math.max(0, focus[0]! - 0.03),
          Math.max(0, focus[1]! - 0.03),
          Math.min(1, focus[2]! + 0.03),
          Math.min(1, focus[3]! + 0.03),
        ]
      : [0, 0, 1, 1];
    const state = this.panel.querySelector('#ground-ai-state')!;
    state.textContent = 'Local selection: loading / processing…';
    try {
      const result = await this.host.request(
        {
          asset: m.asset.id,
          frame,
          hash: m.pages.find((p) => p.id === m.frames.find((f) => f.id === frame)?.page)!.hash,
          crop,
          box: this.box,
          points: this.prompts,
        },
        abort.signal,
      );
      if (request !== this.request || abort.signal.aborted || d !== this.host.document()) return;
      const candidate = this.candidates.find((c) => c.box === this.box);
      if (candidate) candidate.mask = result.mask;
      this.proposal = result.mask;
      state.textContent = `Selection ready · ${result.device} · ${Math.round(result.milliseconds)} ms. Review, then accept.`;
      this.signature = '';
    } catch (e) {
      if (!abort.signal.aborted) {
        state.textContent = String(e);
        this.host.status(String(e), true);
      }
    } finally {
      if (request === this.request) this.abort = undefined;
    }
  }
  private selectionIdentity() {
    const d = this.host.document(),
      m = this.host.manifest();
    if (!m || d.floor.layout !== 'artwork')
      throw new Error('Choose a single-image artwork floor first.');
    const frame = m.frames.find(
      (f) => f.id === m.asset.clips[d.floor.clip ?? 'still']?.d45?.frames[0],
    );
    const page = m.pages.find((p) => p.id === frame?.page);
    if (!frame || !page) throw new Error('Ground artwork is not ready.');
    return {
      asset: m.asset.id,
      frame: frame.id,
      hash: page.hash,
      dimensions: [...m.asset.canvas] as UV,
    };
  }
  private async loadProfiles() {
    const d = this.host.document(),
      identity = this.selectionIdentity();
    const response = await fetch('/__lantern_editor?groundProfiles', {
      signal: this.lifetime.signal,
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    if (d !== this.host.document()) return;
    const profiles = data.profiles as {
      id: string;
      name: string;
      hash: string;
      regions: number;
      error?: string;
    }[];
    profiles.sort((a, b) => Number(b.hash === identity.hash) - Number(a.hash === identity.hash));
    this.panel.querySelector<HTMLSelectElement>('#ground-profile')!.replaceChildren(
      new Option('Choose a saved revision', ''),
      ...profiles.map((p) => {
        const option = new Option(
          `${p.name} · ${p.regions} regions · ${p.id.slice(0, 8)}${p.hash === identity.hash ? ' · matching artwork' : ' · artwork differs'}`,
          p.id,
        );
        option.disabled = !!p.error;
        if (p.error) option.textContent = 'Unreadable profile · ' + p.id.slice(0, 8);
        return option;
      }),
    );
    this.host.status(`${profiles.length} saved interaction revisions available.`);
  }
  private async restoreProfile() {
    const id = this.panel.querySelector<HTMLSelectElement>('#ground-profile')!.value;
    if (!id) throw new Error('Choose a saved interaction revision first.');
    const d = this.host.document(),
      identity = this.selectionIdentity();
    const response = await fetch('/__lantern_editor?groundProfile=' + encodeURIComponent(id), {
      signal: this.lifetime.signal,
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    if (d !== this.host.document()) return;
    const interaction = restoreGroundProfile(
      GroundProfileSchema.parse(data.profile),
      identity,
      d.floor,
      this.panel.querySelector<HTMLInputElement>('#ground-profile-review')!.checked,
    );
    await this.host.change((draft) => {
      draft.groundInteraction = interaction;
    });
    this.host.status(
      'Saved interaction restored. Inspect alignment, collision and depth before saving.',
    );
  }
  private reviewCandidate() {
    const candidate =
      this.candidates[
        Number(this.panel.querySelector<HTMLSelectElement>('#ground-candidate')!.value)
      ];
    this.proposal = candidate?.mask;
    this.box = candidate?.box;
    this.panel.querySelector<HTMLInputElement>('#ground-candidate-included')!.checked =
      candidate?.included ?? false;
    this.signature = '';
  }
  private refreshCandidates() {
    const select = this.panel.querySelector<HTMLSelectElement>('#ground-candidate')!;
    select.replaceChildren(
      ...this.candidates.map(
        (c, i) =>
          new Option(
            `${i + 1}. ${c.name} · ${Math.round(c.score * 100)}%${c.mask ? ' · prepared' : ''}`,
            String(i),
          ),
      ),
    );
    this.reviewCandidate();
  }
  private async findScenery() {
    this.cancel(true);
    const abort = new AbortController(),
      request = ++this.request,
      d = this.host.document();
    this.abort = abort;
    const state = this.panel.querySelector('#ground-ai-state')!;
    state.textContent = 'Finding scenery locally… Cancel selection stops this job.';
    try {
      const { dimensions: _dimensions, ...identity } = this.selectionIdentity();
      const result = await this.host.request(
        {
          ...identity,
          crop: [0, 0, 1, 1],
          operation: 'detect',
          text: this.panel.querySelector<HTMLInputElement>('#ground-find-text')!.value,
        },
        abort.signal,
      );
      if (request !== this.request || abort.signal.aborted || d !== this.host.document()) return;
      this.candidates = (result.candidates ?? []).map((c) => ({ ...c, included: true }));
      this.batchDocument = d;
      this.refreshCandidates();
      state.textContent = `${this.candidates.length} scenery proposals · ${result.device} · ${result.milliseconds} ms. Prepare masks, review duplicates and missed objects.`;
    } catch (e) {
      if (!abort.signal.aborted) state.textContent = String(e);
    } finally {
      if (request === this.request) this.abort = undefined;
    }
  }
  private async prepareScenery() {
    this.abort?.abort();
    const abort = new AbortController(),
      request = ++this.request,
      d = this.host.document();
    this.abort = abort;
    const state = this.panel.querySelector('#ground-ai-state')!;
    try {
      if (this.batchDocument !== d || !this.candidates.length)
        throw new Error('Find scenery for this scene first.');
      const { dimensions: _dimensions, ...identity } = this.selectionIdentity();
      const included = this.candidates.filter((c) => c.included);
      for (const [index, candidate] of included.entries()) {
        if (candidate.mask) continue;
        state.textContent = `Preparing mask ${index + 1}/${included.length} · ${candidate.name}. Cancel selection stops this job.`;
        const [a, b, c, e] = candidate.box,
          pad = 0.025;
        const result = await this.host.request(
          {
            ...identity,
            crop: [
              Math.max(0, a - pad),
              Math.max(0, b - pad),
              Math.min(1, c + pad),
              Math.min(1, e + pad),
            ],
            box: candidate.box,
          },
          abort.signal,
        );
        if (request !== this.request || abort.signal.aborted || d !== this.host.document()) return;
        if (!result.mask.length)
          throw new Error(
            `No silhouette for ${candidate.name}. Exclude it or refine its selection.`,
          );
        candidate.mask = result.mask;
        this.refreshCandidates();
      }
      state.textContent = `${included.filter((c) => c.mask).length} masks prepared. Review proposals before accepting. Collision and depth require separate validation.`;
    } catch (e) {
      if (!abort.signal.aborted) state.textContent = String(e);
    } finally {
      if (request === this.request) this.abort = undefined;
    }
  }
  private async acceptScenery() {
    try {
      if (this.abort) throw new Error('Wait for preparation or cancel it before accepting masks.');
      const candidates = this.candidates.filter((c) => c.included && c.mask?.length);
      if (!candidates.length || this.batchDocument !== this.host.document())
        throw new Error('Prepare scenery masks for this scene first.');
      const identity = this.selectionIdentity();
      await this.host.change((d) => {
        d.groundInteraction ??= { ...identity, regions: [], destinations: [] };
        const layout = artworkFloorLayout(d.floor.width, d.floor.depth);
        for (const c of candidates) {
          const mask = c.mask!;
          const all = mask.flatMap((shape) => shape.outer);
          const u = (Math.min(...all.map((p) => p[0])) + Math.max(...all.map((p) => p[0]))) / 2;
          const v = Math.max(...all.map((p) => p[1]));
          d.groundInteraction.regions.push({
            id: 'region-' + crypto.randomUUID(),
            name: c.name,
            mask,
            depth: { kind: 'anchor', point: layout.world([u, v]) },
          });
        }
      });
      this.cancel(true);
      this.host.status(
        `${candidates.length} scenery masks accepted in one undoable edit. Validate their depth and blocking footprints.`,
      );
    } catch (e) {
      this.host.status(String(e), true);
    }
  }
  private cancel(clearCandidates = false) {
    const pointer = this.pointer;
    this.pointer = undefined;
    if (pointer !== undefined && this.canvas.hasPointerCapture(pointer))
      this.canvas.releasePointerCapture(pointer);
    this.request++;
    this.abort?.abort();
    this.abort = undefined;
    this.points = [];
    this.gesture = undefined;
    this.vertex = undefined;
    this.proposal = undefined;
    this.prompts = [];
    this.box = undefined;
    if (clearCandidates) {
      this.candidates = [];
      this.batchDocument = undefined;
      this.panel
        .querySelector<HTMLSelectElement>('#ground-candidate')!
        .replaceChildren(new Option('Find scenery first', ''));
    }
    this.signature = '';
  }
  draw() {
    const d = this.host.document(),
      p = this.host.view().presentation;
    if (!p) return;
    if (this.previous !== d) {
      this.signature = '';
      this.panel.querySelector<HTMLInputElement>('#ground-profile-review')!.checked = false;
      if (this.previous) this.cancel(true);
      this.previous = d;
      const select = this.panel.querySelector<HTMLSelectElement>('#ground-region')!;
      select.replaceChildren(
        new Option('New region', ''),
        ...(d.groundInteraction?.regions.map((r) => new Option(r.name, r.id)) ?? []),
      );
      select.value = this.selected;
      this.updateName();
    }
    const rect = this.canvas.getBoundingClientRect(),
      parent = this.canvas.parentElement!.getBoundingClientRect();
    const signature = [
      this.previous === d ? 'current' : 'changed',
      this.selected,
      this.points,
      this.gesture,
      this.proposal,
      p.camera.position.toArray(),
      p.camera.zoom,
      rect.width,
      rect.height,
    ]
      .map((v) => (typeof v === 'object' ? JSON.stringify(v) : v))
      .join('|');
    if (signature === this.signature) return;
    this.signature = signature;
    this.svg.style.left = rect.left - parent.left + 'px';
    this.svg.style.top = rect.top - parent.top + 'px';
    this.svg.style.width = rect.width + 'px';
    this.svg.style.height = rect.height + 'px';
    this.svg.setAttribute('viewBox', `0 0 ${rect.width} ${rect.height}`);
    this.svg.replaceChildren();
    const layout = artworkFloorLayout(d.floor.width, d.floor.depth);
    const project = (world: { x: number; z: number }) => {
      const q = new T.Vector3(world.x, 0, world.z).project(p.camera);
      return [((q.x + 1) * rect.width) / 2, ((1 - q.y) * rect.height) / 2];
    };
    const path = (
      rings: readonly (readonly (readonly number[])[])[],
      color: string,
      fill = false,
      handles = false,
    ) => {
      const el = document.createElementNS(ns, 'path');
      el.setAttribute(
        'd',
        rings
          .map(
            (r) =>
              r
                .map((v, i) => {
                  const [x, y] = project(layout.world(v));
                  return `${i ? 'L' : 'M'}${x},${y}`;
                })
                .join(' ') + (fill ? ' Z' : ''),
          )
          .join(' '),
      );
      el.setAttribute('stroke', color);
      el.setAttribute('stroke-width', '1.5');
      el.setAttribute('fill', fill ? color : 'none');
      el.setAttribute('fill-opacity', '.16');
      el.setAttribute('fill-rule', 'evenodd');
      this.svg.append(el);
      if (this.mode === 'off' && handles)
        for (const ring of rings)
          for (const uv of ring) {
            const [x, y] = project(layout.world(uv)),
              handle = document.createElementNS(ns, 'circle');
            handle.setAttribute('cx', String(x));
            handle.setAttribute('cy', String(y));
            handle.setAttribute('r', '2');
            handle.setAttribute('fill', color);
            this.svg.append(handle);
          }
    };
    for (const r of d.groundInteraction?.regions ?? []) {
      if (this.overlays.blockers && r.footprint)
        path([r.footprint.map((v) => layout.uv(v))], '#e79b70', true, r.id === this.selected);
      if (this.overlays.masks)
        for (const shape of r.mask ?? [])
          path(
            [shape.outer, ...shape.holes],
            r.id === this.selected ? '#ffe0a3' : '#8c9fe0',
            true,
            r.id === this.selected,
          );
      if (this.overlays.depth && r.depth) {
        if (r.depth.kind === 'boundary')
          path([r.depth.points.map((v) => layout.uv(v))], '#78d6bf', false, r.id === this.selected);
        else {
          const [x, y] = project(r.depth.point),
            circle = document.createElementNS(ns, 'circle');
          circle.setAttribute('cx', String(x));
          circle.setAttribute('cy', String(y));
          circle.setAttribute('r', '5');
          circle.setAttribute('fill', '#78d6bf');
          this.svg.append(circle);
        }
      }
    }
    for (const shape of this.proposal ?? []) path([shape.outer, ...shape.holes], '#ffe38a', true);
    if (this.points.length) path([this.points], '#fff');
    if (this.gesture) path([this.gesture], '#fff');
  }
  dispose() {
    this.cancel();
    this.lifetime.abort();
    this.svg.remove();
    this.panel.remove();
  }
}
