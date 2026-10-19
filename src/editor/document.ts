import type { SceneDocument, SceneSnapshot } from '../content/scene-document';
import { EditorHistory } from './model';
import { readUntilAborted } from '../assets/abort';

export type EditorSnapshot = Readonly<
  Pick<EditorHistory, 'document' | 'canUndo' | 'canRedo' | 'descendants' | 'fragment'>
>;

// The view must accept a candidate before it becomes editable state.
export class EditorDocument {
  private current: EditorHistory;
  private pending = false;
  private snapshot!: EditorSnapshot;
  private accept(history: EditorHistory) {
    this.current = history;
    this.snapshot = Object.freeze({
      document: history.document,
      canUndo: history.canUndo,
      canRedo: history.canRedo,
      descendants: (ids: readonly string[]) => history.descendants(ids),
      fragment: (ids: readonly string[]) => history.fragment(ids),
    });
  }
  constructor(
    document: SceneSnapshot,
    private readonly apply: (document: SceneSnapshot) => Promise<void>,
    private readonly validate: (document: SceneSnapshot) => void,
    private readonly signal: AbortSignal,
  ) {
    this.current = EditorHistory.create(document);
    this.accept(this.current);
  }
  get history(): EditorSnapshot {
    return this.snapshot;
  }
  reidentify(id: string, target: SceneDocument['target']) {
    if (this.pending) throw new Error('Scene update in progress');
    this.signal.throwIfAborted();
    const next = this.current.fork();
    next.reidentify(id, target);
    this.accept(next);
  }
  edit(work: (candidate: EditorHistory) => void) {
    return this.update(() => {
      const candidate = this.current.fork();
      work(candidate);
      return candidate;
    });
  }
  replace(document: SceneSnapshot) {
    return this.update(() => EditorHistory.create(document));
  }
  private update(prepare: () => EditorHistory) {
    // EditorView owns acquisition/draining. This caller borrows only completion;
    // closing the editor must settle it even if rendering never returns.
    return readUntilAborted(this.updateOwned(prepare), this.signal);
  }
  private async updateOwned(prepare: () => EditorHistory) {
    this.signal.throwIfAborted();
    if (this.pending) throw new Error('Scene update in progress');
    this.pending = true;
    let applying = false;
    try {
      const candidate = prepare().fork();
      this.signal.throwIfAborted();
      if (candidate.document !== this.current.document) {
        this.validate(candidate.document);
        this.signal.throwIfAborted();
        applying = true;
        await this.apply(candidate.document);
        this.signal.throwIfAborted();
      }
      this.accept(candidate);
    } catch (error) {
      if (applying && !this.signal.aborted) {
        try {
          await this.apply(this.current.document);
        } catch (rollback) {
          throw new AggregateError([error, rollback], 'Scene update and view recovery failed');
        }
      }
      throw error;
    } finally {
      this.pending = false;
    }
  }
}
