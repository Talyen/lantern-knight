import { readUntilAborted } from '../assets/abort';
import { parseSceneDocument, type SceneDocument } from '../content/scene-document';
import type { EditorDocument } from './document';
import type { EditorHistory } from './model';
import { emptyScene } from './default-scene';

export class EditorConflict extends Error {}

// File identity and dirty-state baselines belong to the accepted document, independent of its controls.
export class EditorProject {
  private operation: 'replacement' | 'saving' | 'accepting-save' | undefined;
  private editing?: Promise<void>;
  private revisionValue: string | null = null;
  private baseRevision = '';
  private token = '';
  private savedSnapshot = '';
  constructor(
    private readonly documents: EditorDocument,
    private readonly normalize: (document: SceneDocument) => SceneDocument,
    private readonly signal: AbortSignal,
    private readonly request: typeof fetch = globalThis.fetch.bind(globalThis),
  ) {}
  private async run<T>(kind: 'replacement' | 'saving', work: () => Promise<T>): Promise<T> {
    this.signal.throwIfAborted();
    if (this.operation || this.editing) throw new Error('Scene project operation in progress');
    this.operation = kind;
    try {
      return await readUntilAborted(work(), this.signal);
    } finally {
      this.operation = undefined;
    }
  }
  list() {
    return this.run('replacement', () => this.listOwned());
  }
  open(value: string) {
    return this.run('replacement', () => this.openOwned(value));
  }
  import(document: SceneDocument) {
    return this.run('replacement', () => this.importOwned(document));
  }
  save(copyId?: string) {
    return this.run('saving', () => this.saveOwned(copyId));
  }
  get revision() {
    return this.revisionValue;
  }
  get dirty() {
    return JSON.stringify(this.documents.history.document) !== this.savedSnapshot;
  }
  private async json(url: string, init: RequestInit = {}) {
    const signal = AbortSignal.any([this.signal, ...(init.signal ? [init.signal] : [])]);
    signal.throwIfAborted();
    const response = await readUntilAborted(
      this.request.call(globalThis, url, { ...init, signal }),
      signal,
    );
    signal.throwIfAborted();
    const data = await readUntilAborted(response.json(), signal);
    signal.throwIfAborted();
    if (!response.ok) {
      if (response.status === 409) throw new EditorConflict(data.error);
      throw new Error(data.error);
    }
    return data;
  }
  private api(id?: string) {
    return this.json('/__lantern_editor' + (id ? '?id=' + encodeURIComponent(id) : ''));
  }
  private async listOwned() {
    const data = await this.api();
    this.signal.throwIfAborted();
    this.token = data.token;
    this.baseRevision = data.baseRevision;
    return data.scenes as { id: string; name: string; target?: string; error?: string }[];
  }
  private async openOwned(value: string) {
    let document = emptyScene(),
      revision: string | null = null,
      baseRevision = this.baseRevision,
      savedSnapshot = '';
    if (value !== 'new') {
      const id = value.startsWith('file-')
        ? value.slice(5)
        : value.startsWith('copy-')
          ? 'live-' + value.slice(5)
          : value;
      const data = await this.api(id);
      this.signal.throwIfAborted();
      if (!data.document) throw new Error('Scene file is unavailable');
      document = this.normalize(parseSceneDocument(data.document));
      revision = data.revision;
      baseRevision = data.baseRevision;
      if (value.startsWith('copy-')) {
        document = {
          ...document,
          id: 'untitled',
          name: 'Copy of ' + document.name.slice(0, 72),
          target: 'draft',
        };
        revision = null;
      } else savedSnapshot = JSON.stringify(document);
    }
    await this.documents.replace(document);
    this.signal.throwIfAborted();
    this.revisionValue = revision;
    this.baseRevision = baseRevision;
    this.savedSnapshot = savedSnapshot;
  }
  async edit(work: (history: EditorHistory) => void) {
    this.signal.throwIfAborted();
    if ((this.operation && this.operation !== 'saving') || this.editing)
      throw new Error('Scene project operation in progress');
    // Register before invoking a caller-owned edit callback.
    const completion = Promise.withResolvers<void>();
    this.editing = completion.promise;
    try {
      await this.documents.edit(work);
      this.signal.throwIfAborted();
    } finally {
      this.editing = undefined;
      completion.resolve();
    }
  }
  private async importOwned(document: SceneDocument) {
    await this.documents.replace(document);
    this.signal.throwIfAborted();
    this.revisionValue = null;
    this.savedSnapshot = '';
  }
  async post(body: Record<string, unknown>, signal = this.signal) {
    this.signal.throwIfAborted();
    signal.throwIfAborted();
    return this.json('/__lantern_editor', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Lantern-Editor-Token': this.token },
      body: JSON.stringify({ ...body, baseRevision: this.baseRevision }),
      signal,
    });
  }
  private async saveOwned(copyId?: string) {
    const document = parseSceneDocument(
      copyId
        ? { ...this.documents.history.document, id: copyId, target: 'draft' }
        : this.documents.history.document,
    );
    const data = await this.post({ document, revision: copyId ? null : this.revisionValue });
    this.signal.throwIfAborted();
    const accepted = parseSceneDocument(data.document);
    // Keep edits admitted during transport, but close admission before accepting
    // file metadata. Reidentification must follow their view commit or rollback.
    this.operation = 'accepting-save';
    if (this.editing) await readUntilAborted(this.editing, this.signal);
    this.signal.throwIfAborted();
    this.documents.reidentify(accepted.id, accepted.target);
    this.revisionValue = data.revision;
    this.baseRevision = data.baseRevision;
    this.savedSnapshot = JSON.stringify(accepted);
  }
}
