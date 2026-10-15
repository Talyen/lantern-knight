import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EditorDocument } from '../../src/editor/document';
import { EditorProject, EditorConflict } from '../../src/editor/project';
import { emptyScene } from '../../src/editor/default-scene';
import type { SceneDocument } from '../../src/content/scene-document';

function fixture() {
  const lifetime = new AbortController(),
    values = new Map<string, string>();
  let rejectView = false,
    storageFails = false,
    storageErrors = 0;
  let apply: (() => Promise<void>) | undefined;
  let response: (url: string, init?: RequestInit) => Response | Promise<Response>;
  const documents = new EditorDocument(
    emptyScene(),
    async () => {
      await apply?.();
      if (rejectView) {
        rejectView = false;
        throw new Error('view rejected');
      }
    },
    () => {},
    lifetime.signal,
  );
  const json = (value: unknown, status = 200) => Response.json(value, { status });
  const requests: { document: SceneDocument; revision: string | null; baseRevision: string }[] = [];
  let revision = 0;
  response = (url, init) => {
    if (init?.method === 'POST') {
      const request = JSON.parse(init.body as string);
      requests.push(request);
      return json({
        document: request.document,
        revision: 'revision-' + ++revision,
        baseRevision: 'base',
      });
    }
    if (url.includes('?id='))
      return json({
        document: { ...emptyScene(), id: 'existing', name: 'On disk' },
        revision: 'existing-revision',
        baseRevision: 'base',
      });
    return json({ token: 'token', workspace: 'workspace', baseRevision: 'base', scenes: [] });
  };
  const project = new EditorProject(
    documents,
    (document) => document,
    lifetime.signal,
    'recovery:',
    () => {
      if (storageFails) throw new Error('storage denied');
      return {
        get length() {
          return values.size;
        },
        key: (index) => [...values.keys()][index] ?? null,
        getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => {
          values.set(key, value);
        },
        removeItem: (key) => {
          values.delete(key);
        },
      };
    },
    () => {
      storageErrors++;
    },
    async function (this: unknown, url, init) {
      assert.ok(this === globalThis, 'Fetch requires its global receiver');
      return response(
        typeof url === 'string' ? url : url instanceof URL ? url.href : url.url,
        init,
      );
    },
  );
  return {
    project,
    documents,
    values,
    lifetime,
    requests,
    json,
    failView: () => {
      rejectView = true;
    },
    failStorage: () => {
      storageFails = true;
    },
    storageErrors: () => storageErrors,
    apply: (work?: () => Promise<void>) => {
      apply = work;
    },
    respond: (work: typeof response) => {
      response = work;
    },
  };
}
const recovery = (document: SceneDocument) =>
  JSON.stringify({
    document,
    revision: 'recovered-revision',
    baseRevision: 'old-base',
    savedSnapshot: '',
  });

it('import switches pending recovery to its own identity and preserves older drafts', async () => {
  const f = fixture();
  await f.project.list();
  const oldKey = 'recovery:workspace:existing';
  const newKey = 'recovery:workspace:untitled';
  const oldRaw = recovery({ ...emptyScene(), id: 'existing', name: 'Old recovered work' });
  const newRaw = recovery({ ...emptyScene(), name: 'Earlier imported work' });
  f.values.set(oldKey, oldRaw);
  f.values.set(newKey, newRaw);
  await f.project.open('file-existing');
  await f.project.import({ ...emptyScene(), name: 'New import' });
  assert.equal(f.values.get(oldKey), oldRaw);
  assert.equal(f.values.get(newKey), newRaw);
  assert.equal(f.project.recoveryPending, true);
  await f.project.restoreRecovery();
  assert.equal(f.documents.history.document.name, 'Earlier imported work');
});

it('confirmed imports at the current identity replace its recovery and remain editable', async () => {
  const f = fixture();
  await f.project.list();
  await f.project.open('new');
  await f.project.edit((h) =>
    h.change((d) => {
      d.name = 'Before import';
    }),
  );
  await f.project.import({ ...emptyScene(), name: 'Accepted import' });
  assert.equal(f.project.recoveryPending, false);
  const key = 'recovery:workspace:untitled';
  assert.equal(JSON.parse(f.values.get(key)!).document.name, 'Accepted import');
});

it('dismissing an older recovery immediately protects the current unsaved document', async () => {
  const f = fixture();
  await f.project.list();
  const key = 'recovery:workspace:untitled';
  f.values.set(key, recovery({ ...emptyScene(), name: 'Older work' }));
  await f.project.open('new');
  await f.project.edit((h) =>
    h.change((d) => {
      d.name = 'Current work';
    }),
  );
  f.project.dismissRecovery();
  assert.equal(f.project.recoveryPending, false);
  assert.equal(JSON.parse(f.values.get(key)!).document.name, 'Current work');
});

it('Save As preserves a pre-existing recovery at its new file identity', async () => {
  const f = fixture();
  await f.project.list();
  const key = 'recovery:workspace:copy',
    raw = recovery({ ...emptyScene(), id: 'copy', name: 'Unsaved copy edits' });
  f.values.set(key, raw);
  await f.project.save('copy');
  assert.equal(f.project.revision, 'revision-1');
  assert.equal(f.values.get(key), raw);
  assert.equal(f.project.recoveryPending, true);
  await f.project.restoreRecovery();
  assert.equal(f.documents.history.document.name, 'Unsaved copy edits');
});

describe('editor project ownership', () => {
  it('accepts completed saves despite unavailable recovery storage and retains copy identity through undo', async () => {
    const f = fixture();
    await f.project.list();
    await f.project.edit((history) =>
      history.change((d) => {
        d.name = 'Edited';
      }),
    );
    f.project.recover();
    f.failStorage();
    await f.project.save('copy');
    assert.equal(f.project.revision, 'revision-1');
    assert.equal(f.project.dirty, false);
    assert.equal(f.documents.history.document.id, 'copy');
    assert.ok(f.storageErrors() > 0);
    await f.project.edit((history) => history.undo());
    assert.equal(f.documents.history.document.id, 'copy');
    assert.equal(f.project.dirty, true);
    await f.project.save();
    assert.equal(f.requests[1]!.revision, 'revision-1');
    assert.equal(f.project.revision, 'revision-2');
    assert.equal(f.project.dirty, false);
    f.respond(() => f.json({ error: 'changed on disk' }, 409));
    await assert.rejects(f.project.save(), EditorConflict);
    assert.equal(f.project.revision, 'revision-2');
  });

  it('keeps accepted history, file revision and recovery identity together when replacements fail', async () => {
    const f = fixture();
    await f.project.list();
    await f.project.open('file-existing');
    const accepted = f.documents.history.document;
    f.failView();
    await assert.rejects(f.project.open('new'), /view rejected/);
    assert.deepEqual(f.documents.history.document, accepted);
    assert.equal(f.project.revision, 'existing-revision');
    assert.equal(f.project.dirty, false);
    f.failView();
    await assert.rejects(f.project.import({ ...emptyScene(), id: 'imported' }), /view rejected/);
    assert.equal(f.project.revision, 'existing-revision');
    const key = 'recovery:workspace:recovered';
    f.values.set(key, recovery({ ...emptyScene(), id: 'recovered' }));
    f.project.readRecovery(key);
    f.failView();
    await assert.rejects(f.project.restoreRecovery(), /view rejected/);
    assert.equal(f.project.recoveryPending, true);
    assert.deepEqual(f.documents.history.document, accepted);
    assert.equal(f.project.revision, 'existing-revision');
    assert.equal(await f.project.restoreRecovery(), true);
    assert.equal(f.project.revision, 'recovered-revision');
    assert.equal(f.documents.history.document.id, 'recovered');
    assert.equal(f.project.dirty, true);
    assert.equal(f.project.recoveryPending, false);
    assert.equal(JSON.parse(f.values.get(key)!).baseRevision, 'base');
  });

  it('keeps recovery selection separate from the active file and confines it to the exact workspace', async () => {
    const f = fixture();
    await f.project.list();
    await f.project.open('file-existing');
    await f.project.edit((history) =>
      history.change((d) => {
        d.name = 'Current edits';
      }),
    );
    f.project.recover();
    const current = f.values.get('recovery:workspace:existing');
    const key = 'recovery:workspace:other';
    const raw = recovery({ ...emptyScene(), id: 'other' });
    f.values.set(key, raw);
    f.values.set('recovery:workspace-neighbor:other', raw);
    assert.equal(f.project.recoveryEntries().length, 2);
    assert.throws(
      () => f.project.readRecovery('recovery:workspace-neighbor:other'),
      /another workspace/,
    );
    f.project.readRecovery(key);
    f.project.recover();
    assert.equal(f.values.get(key), raw);
    assert.equal(f.project.recoverySource(), raw);
    f.project.dismissRecovery();
    f.project.recover();
    assert.equal(f.values.has(key), false);
    assert.equal(
      JSON.parse(f.values.get('recovery:workspace:existing')!).document.name,
      'Current edits',
    );
    assert.equal(JSON.parse(current!).document.id, 'existing');
    f.values.set(key, JSON.stringify({ document: emptyScene(), revision: {}, savedSnapshot: '' }));
    f.project.readRecovery(key);
    assert.equal(f.project.recoveryPending, true);
    assert.equal(f.project.recoveryReadable, false);
    await assert.rejects(f.project.restoreRecovery(), /unreadable/);
    assert.equal(f.documents.history.document.id, 'existing');
  });

  it('keeps edits made during a save dirty against the document actually written', async () => {
    const f = fixture();
    await f.project.list();
    const { promise: response, resolve: finish } = Promise.withResolvers<Response>();
    let written!: SceneDocument;
    f.respond((_url, init) => {
      written = JSON.parse(init!.body as string).document;
      return response;
    });
    const saving = f.project.save('copy');
    await f.project.edit((history) =>
      history.change((d) => {
        d.name = 'Edited during save';
      }),
    );
    finish(f.json({ document: written, revision: 'written', baseRevision: 'base' }));
    await saving;
    assert.equal(f.project.revision, 'written');
    assert.equal(f.project.dirty, true);
    assert.equal(f.documents.history.document.name, 'Edited during save');
    assert.equal(f.documents.history.document.id, 'copy');
    assert.equal(
      JSON.parse(f.values.get('recovery:workspace:copy')!).savedSnapshot,
      JSON.stringify(written),
    );
  });

  it('discards late file reads after disposal without replacing the accepted document', async () => {
    const f = fixture();
    await f.project.list();
    const { promise: response, resolve: finish } = Promise.withResolvers<Response>();
    f.respond(() => response);
    const opening = f.project.open('file-existing');
    f.lifetime.abort(new Error('closed'));
    finish(
      f.json({ document: { ...emptyScene(), id: 'late' }, revision: 'late', baseRevision: 'base' }),
    );
    await assert.rejects(opening, /closed/);
    assert.equal(f.documents.history.document.id, 'untitled');
    assert.equal(f.project.revision, null);
    assert.equal(f.values.size, 0);
  });
});

it('opening a saved scene preserves an existing recovery for later restoration', async () => {
  const f = fixture();
  await f.project.list();
  const key = 'recovery:workspace:existing';
  const raw = recovery({ ...emptyScene(), id: 'existing', name: 'Unsaved work' });
  f.values.set(key, raw);
  await f.project.open('file-existing');
  assert.equal(f.values.get(key), raw);
  f.project.readRecovery(key);
  await f.project.restoreRecovery();
  assert.equal(f.documents.history.document.name, 'Unsaved work');
});

it('copies scenes whose names already use the full allowed length', async () => {
  const f = fixture();
  await f.project.list();
  f.respond(() =>
    f.json({
      document: { ...emptyScene(), id: 'live-court', name: 'A'.repeat(80) },
      revision: 'original',
      baseRevision: 'base',
    }),
  );
  await f.project.open('copy-court');
  assert.equal(f.documents.history.document.name, 'Copy of ' + 'A'.repeat(72));
  assert.equal(f.documents.history.document.target, 'draft');
  assert.equal(f.project.revision, null);
});

it('keeps malformed recovery metadata from hiding other recoveries', async () => {
  const f = fixture();
  await f.project.list();
  f.values.set('recovery:workspace:valid', recovery({ ...emptyScene(), name: 'Unsaved work' }));
  f.values.set(
    'recovery:workspace:broken',
    JSON.stringify({ document: { name: 42 }, savedAt: 42 }),
  );
  f.values.set('recovery:workspace:older', JSON.stringify({ savedAt: 7 }));
  const entries = f.project.recoveryEntries();
  assert.equal(entries.length, 3);
  assert.ok(entries.some((entry) => entry.name === 'Unsaved work'));
  const broken = entries.find((entry) => entry.key.endsWith(':broken'))!;
  assert.equal(broken.name, 'Unreadable recovery');
  assert.equal(broken.time, 'Unknown time');
  f.project.readRecovery(broken.key);
  assert.equal(f.project.recoveryReadable, false);
  assert.equal(f.project.recoverySource(), f.values.get(broken.key));
});

it('owns file identity from request admission through save acceptance', async () => {
  const f = fixture();
  await f.project.list();
  const result = Promise.withResolvers<Response>();
  f.respond(() => result.promise);
  const opening = f.project.open('file-existing');
  await assert.rejects(f.project.open('new'), /in progress/);
  assert.throws(() => f.project.readRecovery('recovery:workspace:other'), /in progress/);
  await assert.rejects(f.project.save('copy'), /in progress/);
  await assert.rejects(
    f.project.edit((h) =>
      h.change((d) => {
        d.name = 'Lost edit';
      }),
    ),
    /in progress/,
  );
  result.resolve(
    f.json({
      document: { ...emptyScene(), id: 'existing' },
      revision: 'disk',
      baseRevision: 'base',
    }),
  );
  await opening;
  assert.equal(f.documents.history.document.id, 'existing');
  assert.equal(f.project.revision, 'disk');
  assert.equal(f.project.dirty, false);
});
it('waits for an admitted edit before accepting save metadata and blocks replacement', async () => {
  const f = fixture();
  await f.project.list();
  const result = Promise.withResolvers<Response>();
  let written!: SceneDocument;
  f.respond((_url, init) => {
    written = JSON.parse(init!.body as string).document;
    return result.promise;
  });
  const saving = f.project.save('copy');
  const rendering = Promise.withResolvers<void>();
  f.apply(() => rendering.promise);
  const editing = f.project.edit((h) =>
    h.change((d) => {
      d.name = 'Later edit';
    }),
  );
  await assert.rejects(f.project.import({ ...emptyScene(), id: 'different' }), /in progress/);
  result.resolve(f.json({ document: written, revision: 'saved', baseRevision: 'base' }));
  await new Promise((resolve) => setImmediate(resolve));
  rendering.resolve();
  await editing;
  await saving;
  assert.equal(f.documents.history.document.id, 'copy');
  assert.equal(f.documents.history.document.name, 'Later edit');
  assert.equal(f.project.revision, 'saved');
  assert.equal(f.project.dirty, true);
});

it('cancels save acceptance while an admitted view update is still pending', async () => {
  const f = fixture();
  await f.project.list();
  const response = Promise.withResolvers<Response>();
  let written!: SceneDocument;
  f.respond((_url, init) => {
    written = JSON.parse(init!.body as string).document;
    return response.promise;
  });
  const saving = f.project.save('copy');
  const rendering = Promise.withResolvers<void>();
  f.apply(() => rendering.promise);
  const editing = f.project.edit((h) =>
    h.change((d) => {
      d.name = 'Pending';
    }),
  );
  const editRejected = assert.rejects(editing, /closed/);
  response.resolve(f.json({ document: written, revision: 'saved', baseRevision: 'base' }));
  await new Promise((resolve) => setImmediate(resolve));
  f.lifetime.abort(new Error('closed'));
  await assert.rejects(saving, /closed/);
  assert.equal(f.project.revision, null);
  rendering.resolve();
  await editRejected;
});
