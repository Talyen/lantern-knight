import { html } from '../dom';
import { assetLabel } from '../assets/asset-browser';
import type { Manifest } from '../assets/schema';
import { parseSceneDocument, type SceneSnapshot } from '../content/scene-document';
import {
  assetReviewSchema,
  reviewKey,
  type AssetReviewEntry,
  type AssetReviews,
} from './asset-review-data';
import { reviewSceneAssets, type ReviewUsage } from './asset-review-model';
import { editorError } from './errors';

type Host = {
  document: () => SceneSnapshot;
  manifests: ReadonlyMap<string, Manifest>;
  signal: AbortSignal;
  post: (body: Record<string, unknown>) => Promise<unknown>;
  thumbnail: (asset: string, target: HTMLCanvasElement, clip?: string) => Promise<void>;
  open: (id: string) => Promise<void>;
  focus: (asset: string, usage: ReviewUsage) => void;
};
type SceneUsage = { document: SceneSnapshot; assets: Map<string, ReviewUsage> };

export class AssetReview {
  private reviews: AssetReviews = { version: 1, entries: [] };
  private revision: string | null = null;
  private documents: SceneSnapshot[] = [];
  private scenes: SceneUsage[] = [];
  private current?: SceneSnapshot;
  private selected = '';
  private target = '';
  private focusRequest = 0;
  private drafts = new Map<string, string>();
  private loading = false;
  private loaded = false;
  private writing = false;
  private needsReload = false;
  private observer: IntersectionObserver;
  private $ = <E extends HTMLElement>(id: string) => this.root.querySelector<E>('#' + id)!;
  constructor(
    private readonly root: HTMLElement,
    private readonly host: Host,
  ) {
    this.observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const canvas = entry.target as HTMLCanvasElement;
          this.observer.unobserve(canvas);
          this.preview(canvas.dataset.asset!, canvas, canvas.dataset.clip);
        }
      },
      { root: this.$('review-gallery') },
    );
    root.addEventListener('workspace-show', () => this.refresh(), { signal: host.signal });
    this.$('review-clip').onchange = () => {
      this.preview(
        this.selected,
        this.$<HTMLCanvasElement>('review-preview'),
        this.$<HTMLSelectElement>('review-clip').value,
      );
    };
    this.$('review-view').onchange = () => this.render();
    this.$('review-search').oninput = () => this.renderGallery();
    this.$('review-reload').onclick = () => void this.load();
    this.$('review-target').onchange = () => {
      this.target = this.$<HTMLSelectElement>('review-target').value;
      this.renderNotes();
    };
    this.$('review-notes').oninput = () => {
      const entry = this.entry();
      if (entry)
        this.drafts.set(reviewKey(entry), this.$<HTMLTextAreaElement>('review-notes').value);
      this.$('review-feedback').textContent = 'Notes changed. Save replacement flag to keep them.';
    };
    this.$('review-save').onclick = () => void this.save(false);
    this.$('review-clear').onclick = () => void this.save(true);
    host.signal.addEventListener('abort', () => this.observer.disconnect(), { once: true });
  }
  refresh() {
    if (this.host.signal.aborted || this.root.hidden) return;
    if (!this.loaded) {
      if (!this.loading) void this.load().catch((error) => this.feedback(editorError(error), true));
      return;
    }
    const current = this.host.document();
    if (current !== this.current) this.render();
  }
  private feedback(message: string, error = false) {
    if (this.host.signal.aborted) return;
    this.$('review-feedback').textContent = message;
    this.$('review-feedback').classList.toggle('error', error);
  }
  private async load() {
    if (this.loading || this.writing || this.host.signal.aborted) return;
    this.loading = true;
    this.$<HTMLButtonElement>('review-reload').disabled = true;
    this.feedback('Loading scenes and replacement queue…');
    try {
      const response = await fetch('/__lantern_editor?assetReview', { signal: this.host.signal });
      const data = await response.json();
      this.host.signal.throwIfAborted();
      if (!response.ok) throw new Error(data.error);
      this.reviews = assetReviewSchema.parse(data.reviews);
      this.revision = data.revision;
      this.documents = data.documents.map(parseSceneDocument);
      this.loaded = true;
      this.needsReload = false;
      this.render();
      this.$('review-warnings').textContent = data.warnings.join('\n');
      this.feedback('Queue loaded. Unsaved notes are kept until you save or close the editor.');
    } catch (error) {
      this.loaded = true;
      this.feedback(editorError(error), true);
    } finally {
      this.loading = false;
      if (!this.host.signal.aborted) this.$<HTMLButtonElement>('review-reload').disabled = false;
    }
  }
  private render() {
    if (this.host.signal.aborted) return;
    this.current = this.host.document();
    const documents = this.documents.filter((d) => d.id !== this.current!.id);
    documents.push(this.current);
    const warnings: string[] = [];
    this.scenes = documents.flatMap((document) => {
      try {
        return [{ document, assets: reviewSceneAssets(document, this.host.manifests) }];
      } catch (error) {
        warnings.push(`${document.name}: ${editorError(error)}`);
        return [];
      }
    });
    this.$('review-usage-warnings').textContent = warnings.join('\n');
    const select = this.$<HTMLSelectElement>('review-view');
    const previous = select.value;
    select.replaceChildren(
      new Option('Current scene (including unsaved edits)', 'current'),
      new Option('All scenes', 'all'),
      new Option(
        `To replace (${new Set(this.reviews.entries.map((entry) => entry.asset)).size})`,
        'queue',
      ),
      ...this.scenes.map(({ document }) => new Option(document.name, 'scene:' + document.id)),
    );
    select.value = [...select.options].some((o) => o.value === previous) ? previous : 'current';
    this.renderGallery();
    this.renderDetail();
  }
  private visibleScenes() {
    const scope = this.$<HTMLSelectElement>('review-view').value;
    if (scope === 'current') return this.scenes.filter((s) => s.document.id === this.current?.id);
    if (scope.startsWith('scene:'))
      return this.scenes.filter((s) => s.document.id === scope.slice(6));
    return this.scenes;
  }
  private renderGallery() {
    this.observer.disconnect();
    const gallery = this.$('review-gallery');
    gallery.replaceChildren();
    const queue = this.$<HTMLSelectElement>('review-view').value === 'queue';
    const visible = this.visibleScenes();
    const assets = queue
      ? new Set(this.reviews.entries.map((e) => e.asset))
      : new Set(visible.flatMap((s) => [...s.assets.keys()]));
    const query = this.$<HTMLInputElement>('review-search').value.toLowerCase().trim();
    const matches = [...assets]
      .filter((asset) => {
        const manifest = this.host.manifests.get(asset);
        return `${asset} ${manifest ? assetLabel(manifest) : ''} ${this.reviews.entries
          .filter((e) => e.asset === asset)
          .map((e) => e.notes)
          .join(' ')}`
          .toLowerCase()
          .includes(query);
      })
      .sort((a, b) => this.label(a).localeCompare(this.label(b)));
    this.$('review-count').textContent = `${matches.length} assets · ${visible.length} scenes`;
    if (!matches.length)
      gallery.textContent = queue ? 'No assets are marked for replacement.' : 'No matching assets.';
    for (const asset of matches) {
      const flags = this.reviews.entries.filter((e) => e.asset === asset);
      const usages = visible.filter((s) => s.assets.has(asset));
      const badge = flags.some((flag) => flag.scene === null)
        ? 'Retire everywhere'
        : visible.length === 1 && flags.some((flag) => flag.scene === visible[0]!.document.id)
          ? 'Replace in this scene'
          : flags.length
            ? `${flags.length} replacement ${flags.length === 1 ? 'flag' : 'flags'}`
            : `${usages.length} ${usages.length === 1 ? 'scene' : 'scenes'}`;
      const canvas = html<HTMLCanvasElement>`<canvas width="192" height="112" data-asset="${asset}" data-clip="${usages[0]?.assets.get(asset)?.clips[0] ?? ''}" aria-hidden="true"></canvas>`;
      const button = html<HTMLButtonElement>`<button class="review-asset" data-asset="${asset}" aria-pressed="${String(this.selected === asset)}">${canvas}<span>${this.label(asset)}</span><small>${badge}</small></button>`;
      button.onclick = () => {
        this.selected = asset;
        this.target = '';
        for (const sibling of gallery.querySelectorAll('button'))
          sibling.setAttribute('aria-pressed', String(sibling === button));
        this.renderDetail();
      };
      gallery.append(button);
      this.observer.observe(canvas);
    }
  }
  private label(asset: string) {
    const manifest = this.host.manifests.get(asset);
    return manifest ? assetLabel(manifest) : asset;
  }
  private entry(): AssetReviewEntry | undefined {
    if (!this.selected || !this.target) return;
    return {
      asset: this.selected,
      scene: this.target === 'everywhere' ? null : this.target.slice(6),
      notes: '',
    };
  }
  private renderDetail() {
    this.$('review-detail').hidden = !this.selected;
    if (!this.selected) return;
    const asset = this.selected;
    this.$('review-name').textContent = this.label(asset);
    this.$('review-identity').textContent = asset;
    const preview = html<HTMLCanvasElement>`<canvas id="review-preview" width="192" height="128" aria-label="Selected asset preview"></canvas>`;
    this.$('review-preview').replaceWith(preview);
    const uses = this.scenes.filter((s) => s.assets.has(asset));
    const manifest = this.host.manifests.get(asset);
    const usedClips = [
      ...new Set(
        [...this.visibleScenes(), ...uses].flatMap((use) => use.assets.get(asset)?.clips ?? []),
      ),
    ].filter((clip) => manifest?.asset.clips[clip]);
    const clips = this.$<HTMLSelectElement>('review-clip');
    clips.replaceChildren(
      ...(usedClips.length ? usedClips : Object.keys(manifest?.asset.clips ?? {})).map(
        (clip) => new Option(clip, clip),
      ),
    );
    clips.closest('label')!.hidden = clips.options.length < 2;
    this.preview(asset, preview, clips.value);
    const list = this.$('review-usages');
    list.replaceChildren();
    if (!uses.length)
      list.textContent = 'No current scene references. The flag stays in the queue until cleared.';
    for (const { document, assets } of uses) {
      const usage = assets.get(asset)!;
      const count = usage.points.length ? ` · ${usage.points.length} placements` : '';
      const button = html<HTMLButtonElement>`<button>${document.name} · ${usage.roles.join(', ')}${count}</button>`;
      button.onclick = () => void this.focus(document.id, asset);
      list.append(button);
    }
    const select = this.$<HTMLSelectElement>('review-target');
    select.replaceChildren(
      new Option('Retire everywhere · delete after replacement', 'everywhere'),
    );
    // Keep orphaned scene flags editable, even after their references disappear.
    const sceneIds = new Set([
      ...uses.map((s) => s.document.id),
      ...this.reviews.entries
        .filter((e) => e.asset === asset && e.scene !== null)
        .map((e) => e.scene!),
    ]);
    for (const id of sceneIds) {
      const name = this.scenes.find((s) => s.document.id === id)?.document.name ?? id;
      const option = new Option(`Replace in ${name}`, 'scene:' + id);
      option.disabled = id === 'untitled';
      if (option.disabled) option.text += ' (save scene first)';
      select.add(option);
    }
    const specific = this.visibleScenes();
    const defaultScene =
      specific.length === 1 &&
      specific[0]!.assets.has(asset) &&
      specific[0]!.document.id !== 'untitled'
        ? 'scene:' + specific[0]!.document.id
        : 'everywhere';
    const existing = this.reviews.entries.find((e) => e.asset === asset);
    select.value =
      this.target ||
      (existing
        ? existing.scene === null
          ? 'everywhere'
          : 'scene:' + existing.scene
        : defaultScene);
    this.target = select.value;
    this.renderNotes();
  }
  private renderNotes() {
    const entry = this.entry();
    if (!entry) return;
    const key = reviewKey(entry);
    const saved = this.reviews.entries.find((e) => reviewKey(e) === key);
    this.$<HTMLTextAreaElement>('review-notes').value = this.drafts.get(key) ?? saved?.notes ?? '';
    this.$<HTMLButtonElement>('review-clear').disabled = this.writing || this.needsReload || !saved;
    this.$<HTMLButtonElement>('review-save').disabled = this.writing || this.needsReload;
    const flags = this.reviews.entries.filter((e) => e.asset === this.selected);
    this.$('review-flags').textContent = flags.length
      ? flags
          .map((e) =>
            e.scene === null
              ? 'Retire everywhere'
              : `Replace in ${this.scenes.find((s) => s.document.id === e.scene)?.document.name ?? e.scene}`,
          )
          .join(' · ')
      : 'No replacement flags';
  }
  private async save(clear: boolean) {
    const entry = this.entry();
    if (!entry || this.writing || this.needsReload || this.host.signal.aborted) return;
    entry.notes = this.$<HTMLTextAreaElement>('review-notes').value;
    const key = reviewKey(entry);
    this.drafts.set(key, entry.notes);
    const entries = this.reviews.entries.filter((e) => reviewKey(e) !== key);
    if (!clear) entries.push(entry);
    this.writing = true;
    this.$('review-detail').inert = true;
    this.$<HTMLButtonElement>('review-reload').disabled = true;
    try {
      const data = (await this.host.post({
        action: 'assetReview',
        reviews: { version: 1, entries },
        revision: this.revision,
      })) as { reviews: unknown; revision: string };
      this.host.signal.throwIfAborted();
      this.reviews = assetReviewSchema.parse(data.reviews);
      this.revision = data.revision;
      this.drafts.delete(key);
      this.render();
      this.feedback(
        clear ? 'Replacement flag cleared.' : 'Replacement flag saved to the shared queue.',
      );
    } catch (error) {
      this.needsReload = true;
      this.feedback(editorError(error) + ' Reload queue to retry; your notes are kept.', true);
    } finally {
      this.writing = false;
      if (!this.host.signal.aborted) {
        this.$('review-detail').inert = false;
        this.$<HTMLButtonElement>('review-reload').disabled = false;
        this.renderNotes();
      }
    }
  }
  private async focus(scene: string, asset: string) {
    if (this.writing || this.host.signal.aborted) return;
    const request = ++this.focusRequest;
    try {
      if (this.host.document().id !== scene) await this.host.open('file-' + scene);
      this.host.signal.throwIfAborted();
      // Opening can be cancelled to preserve unsaved work.
      if (
        this.host.document().id !== scene ||
        this.selected !== asset ||
        request !== this.focusRequest
      )
        return;
      const usage = reviewSceneAssets(this.host.document(), this.host.manifests).get(asset);
      if (usage) this.host.focus(asset, usage);
    } catch (error) {
      this.feedback(editorError(error), true);
    }
  }
  private preview(asset: string, canvas: HTMLCanvasElement, clip?: string) {
    void this.host.thumbnail(asset, canvas, clip || undefined).catch((error) => {
      if (!this.host.signal.aborted && canvas.isConnected) {
        canvas.setAttribute('aria-label', 'Preview unavailable: ' + editorError(error));
        canvas.classList.add('review-preview-error');
      }
    });
  }
}
