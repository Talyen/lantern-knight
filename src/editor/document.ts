import type { SceneDocument } from '../content/scene-document';
import { EditorHistory } from './model';

export type EditorSnapshot = Readonly<
  Pick<EditorHistory, 'document' | 'canUndo' | 'canRedo' | 'descendants' | 'fragment'>
>;

// The view must accept a candidate before it becomes editable or recoverable state.
export class EditorDocument {
  private current: EditorHistory;
  private pending = false;
  constructor(
    document: SceneDocument,
    private readonly apply: (document: SceneDocument) => Promise<void>,
    private readonly validate: (document: SceneDocument) => void,
    private readonly signal: AbortSignal,
  ) {
    this.current = new EditorHistory(document);
  }
  get history(): EditorSnapshot {
    return this.current;
  }
  reidentify(id: string, target: SceneDocument['target']) {
    if (this.pending) throw new Error('Scene update in progress');
    this.signal.throwIfAborted();
    this.current.reidentify(id, target);
  }
  edit(work: (candidate: EditorHistory) => void) {
    return this.update(() => {
      const candidate = this.current.fork();
      work(candidate);
      return candidate;
    });
  }
  replace(document: SceneDocument) {
    return this.update(() => new EditorHistory(document));
  }
  private async update(prepare: () => EditorHistory) {
    this.signal.throwIfAborted();
    if (this.pending) throw new Error('Scene update in progress');
    this.pending = true;
    try {
      const candidate = prepare();
      this.validate(candidate.document);
      await this.apply(candidate.document);
      this.signal.throwIfAborted();
      this.current = candidate;
    } catch (error) {
      if (!this.signal.aborted) {
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
