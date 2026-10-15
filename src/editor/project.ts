import { z } from 'zod';
import { readUntilAborted } from '../abort';
import { parseSceneDocument, type SceneDocument } from '../content/scene-document';
import type { EditorDocument } from './document';
import type { EditorHistory } from './model';
import { emptyScene } from './default-scene';

const RecoverySchema = z.object({
  document: z.unknown().transform(parseSceneDocument),
  revision: z.string().nullable(),
  baseRevision: z.string(),
  savedSnapshot: z
    .string()
    .transform((value) => (value ? JSON.stringify(parseSceneDocument(JSON.parse(value))) : '')),
  savedAt: z.string().optional(),
});
type Recovery = z.infer<typeof RecoverySchema>;
export class EditorConflict extends Error {}
type StorageAccess = Pick<Storage, 'length' | 'key' | 'getItem' | 'setItem' | 'removeItem'>;

// File identity and recovery belong to the accepted document, independent of its controls.
export class EditorProject {
  private operation: 'replacement' | 'saving' | 'accepting-save' | undefined;
  private editing?: Promise<void>;
  private revisionValue: string | null = null;
  private baseRevision = '';
  private token = '';
  private savedSnapshot = '';
  private recoveryRoot = '';
  private recoveryKey = '';
  private pendingRecovery?: { key: string; data?: Recovery };
  constructor(
    private readonly documents: EditorDocument,
    private readonly normalize: (document: SceneDocument) => SceneDocument,
    private readonly signal: AbortSignal,
    private readonly recoveryPrefix: string,
    private readonly storage: () => StorageAccess,
    private readonly storageError: () => void,
    private readonly request: typeof fetch = globalThis.fetch.bind(globalThis),
  ) {}
  private async run<T>(kind: 'replacement' | 'saving', work: () => Promise<T>): Promise<T> {
    this.signal.throwIfAborted();
    if (this.operation || this.editing) throw new Error('Scene project operation in progress');
    this.operation = kind;
    try {
      return await work();
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
  restoreRecovery() {
    return this.run('replacement', () => this.restoreRecoveryOwned());
  }
  get revision() {
    return this.revisionValue;
  }
  get dirty() {
    return JSON.stringify(this.documents.history.document) !== this.savedSnapshot;
  }
  get recoveryPending() {
    return this.pendingRecovery !== undefined;
  }
  get recoveryReadable() {
    return this.pendingRecovery?.data !== undefined;
  }
  private async api(id?: string) {
    const response = await this.request.call(
      globalThis,
      '/__lantern_editor' + (id ? '?id=' + encodeURIComponent(id) : ''),
      { signal: this.signal },
    );
    const data = await response.json();
    this.signal.throwIfAborted();
    if (!response.ok) throw new Error(data.error);
    return data;
  }
  private async listOwned() {
    const data = await this.api();
    this.token = data.token;
    this.baseRevision = data.baseRevision;
    this.recoveryRoot = this.recoveryPrefix + data.workspace + ':';
    if (!this.recoveryKey) this.recoveryKey = this.recoveryRoot + 'untitled';
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
    this.recoveryKey = this.recoveryRoot + document.id;
    this.readRecoveryOwned(this.recoveryKey);
    this.recover();
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
      this.recover();
    } finally {
      this.editing = undefined;
      completion.resolve();
    }
  }
  private async importOwned(document: SceneDocument) {
    const previousKey = this.recoveryKey;
    const pendingKey = this.pendingRecovery?.key;
    this.recover();
    await this.documents.replace(document);
    this.signal.throwIfAborted();
    this.revisionValue = null;
    this.savedSnapshot = '';
    this.recoveryKey = this.recoveryRoot + document.id;
    this.pendingRecovery = undefined;
    if (this.recoveryKey !== previousKey || pendingKey === this.recoveryKey)
      this.readRecoveryOwned(this.recoveryKey);
    this.recover();
  }
  async post(body: Record<string, unknown>, signal = this.signal) {
    this.signal.throwIfAborted();
    const response = await this.request.call(globalThis, '/__lantern_editor', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Lantern-Editor-Token': this.token },
      body: JSON.stringify({ ...body, baseRevision: this.baseRevision }),
      signal,
    });
    const data = await response.json();
    this.signal.throwIfAborted();
    signal.throwIfAborted();
    if (!response.ok) {
      if (response.status === 409) throw new EditorConflict(data.error);
      throw new Error(data.error);
    }
    return data;
  }
  private async saveOwned(copyId?: string) {
    const document = parseSceneDocument(
      copyId
        ? { ...this.documents.history.document, id: copyId, target: 'draft' }
        : this.documents.history.document,
    );
    const data = await this.post({ document, revision: copyId ? null : this.revisionValue });
    const accepted = parseSceneDocument(data.document);
    // Keep edits admitted during transport, but close admission before accepting
    // file metadata. Reidentification must follow their view commit or rollback.
    this.operation = 'accepting-save';
    if (this.editing) await readUntilAborted(this.editing, this.signal);
    this.signal.throwIfAborted();
    const previousKey = this.recoveryKey;
    this.documents.reidentify(accepted.id, accepted.target);
    this.revisionValue = data.revision;
    this.baseRevision = data.baseRevision;
    this.savedSnapshot = JSON.stringify(accepted);
    this.recoveryKey = this.recoveryRoot + accepted.id;
    // A completed server write remains accepted even when optional local storage fails.
    this.accessStorage((storage) => storage.removeItem(previousKey));
    if (this.recoveryKey !== previousKey) this.readRecoveryOwned(this.recoveryKey);
    this.recover();
  }
  private accessStorage<T>(work: (storage: StorageAccess) => T): T | undefined {
    try {
      return work(this.storage());
    } catch {
      this.storageError();
      return undefined;
    }
  }
  recover() {
    if (this.signal.aborted || this.pendingRecovery || !this.recoveryKey) return;
    this.accessStorage((storage) => {
      if (this.dirty)
        storage.setItem(
          this.recoveryKey,
          JSON.stringify({
            document: this.documents.history.document,
            revision: this.revisionValue,
            baseRevision: this.baseRevision,
            savedSnapshot: this.savedSnapshot,
            savedAt: new Date().toISOString(),
          }),
        );
      else storage.removeItem(this.recoveryKey);
    });
  }
  recoveryEntries() {
    return (
      this.accessStorage((storage) => {
        const entries: { key: string; name: string; time: string }[] = [];
        if (!this.recoveryRoot) return entries;
        for (let i = 0; i < storage.length; i++) {
          const key = storage.key(i)!;
          if (!key.startsWith(this.recoveryRoot)) continue;
          try {
            const data = JSON.parse(storage.getItem(key)!);
            entries.push({
              key,
              name:
                typeof data.document?.name === 'string'
                  ? data.document.name
                  : 'Unreadable recovery',
              time: typeof data.savedAt === 'string' ? data.savedAt : 'Unknown time',
            });
          } catch {
            entries.push({ key, name: 'Unreadable recovery', time: 'Unknown time' });
          }
        }
        return entries.sort((a, b) => b.time.localeCompare(a.time));
      }) ?? []
    );
  }
  readRecovery(key: string) {
    if (this.operation) throw new Error('Scene project operation in progress');
    this.readRecoveryOwned(key);
  }
  private readRecoveryOwned(key: string) {
    if (!this.recoveryRoot || !key.startsWith(this.recoveryRoot))
      throw new Error('Recovery belongs to another workspace');
    this.pendingRecovery = undefined;
    const stored = this.accessStorage((storage) => storage.getItem(key));
    if (!stored) return;
    let data: Recovery | undefined;
    try {
      data = RecoverySchema.parse(JSON.parse(stored));
    } catch {
      // Keep unreadable data available for export or explicit dismissal.
    }
    this.pendingRecovery = { key, data };
  }
  recoverySource() {
    const key = this.pendingRecovery?.key ?? this.recoveryKey;
    return this.accessStorage((storage) => storage.getItem(key));
  }
  dismissRecovery() {
    if (this.operation) throw new Error('Scene project operation in progress');
    const pending = this.pendingRecovery;
    if (!pending) return;
    this.accessStorage((storage) => storage.removeItem(pending.key));
    this.pendingRecovery = undefined;
    this.recover();
  }
  private async restoreRecoveryOwned() {
    const pending = this.pendingRecovery;
    if (!pending?.data) throw new Error('Recovery is unreadable');
    const recovery = pending.data;
    const changedFoundations = recovery.baseRevision !== this.baseRevision;
    await this.documents.replace(recovery.document);
    this.signal.throwIfAborted();
    this.revisionValue = recovery.revision;
    this.savedSnapshot = recovery.savedSnapshot;
    this.recoveryKey = pending.key;
    this.pendingRecovery = undefined;
    this.recover();
    return changedFoundations;
  }
}
