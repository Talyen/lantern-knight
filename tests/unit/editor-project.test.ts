import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EditorDocument } from '../../src/editor/document';
import { EditorProject, EditorConflict } from '../../src/editor/project';
import { emptyScene } from '../../src/editor/default-scene';
import type { SceneDocument } from '../../src/content/scene-document';

function fixture() {
  const lifetime = new AbortController();
  let rejectView = false;
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
    lifetime,
    requests,
    json,
    failView: () => {
      rejectView = true;
    },
    apply: (work?: () => Promise<void>) => {
      apply = work;
    },
    respond: (work: typeof response) => {
      response = work;
    },
  };
}
it('editor shutdown settles transport, response-body and view callers before their work drains', async () => {
  for (const phase of ['transport', 'body', 'view', 'rollback', 'post'] as const) {
    const f = fixture();
    await f.project.list();
    const waiting = Promise.withResolvers<void>();
    let applications = 0;
    f.respond(async () => {
      if (phase === 'transport' || phase === 'post') await waiting.promise;
      return {
        ok: true,
        json: async () => {
          if (phase === 'body') await waiting.promise;
          return {
            document: { ...emptyScene(), id: 'late' },
            revision: 'late',
            baseRevision: 'base',
          };
        },
      } as Response;
    });
    f.apply(async () => {
      applications++;
      if (phase === 'rollback' && applications === 1) throw new Error('render failure');
      await waiting.promise;
    });
    const pending =
      phase === 'post'
        ? f.project.post({ action: 'fragment' })
        : phase === 'view' || phase === 'rollback'
          ? f.project.edit((history) =>
              history.change((d) => {
                d.name = 'Pending';
              }),
            )
          : f.project.open('file-existing');
    let cancelled = false;
    const rejected = assert.rejects(pending, /closed/).then(() => {
      cancelled = true;
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    f.lifetime.abort(new Error('closed'));
    try {
      await new Promise<void>((resolve) => setImmediate(resolve));
      assert.equal(cancelled, true, phase);
    } finally {
      waiting.resolve();
      await rejected;
    }
    assert.equal(f.documents.history.document.name, emptyScene().name, phase);
    assert.equal(f.project.revision, null, phase);
  }
});

it('cancelling an individual editor request settles it without closing its project', async () => {
  const f = fixture(),
    controller = new AbortController(),
    late = Promise.withResolvers<Response>();
  await f.project.list();
  let transportSignal: AbortSignal | undefined;
  f.respond((_url, init) => {
    transportSignal = init?.signal ?? undefined;
    return late.promise;
  });
  const pending = f.project.post({ action: 'segment' }, controller.signal);
  controller.abort(new Error('selection changed'));
  await assert.rejects(pending, /selection changed/);
  assert.equal(transportSignal?.aborted, true);
  assert.equal(f.lifetime.signal.aborted, false);
  f.respond(() =>
    f.json({ scenes: [], token: 'next', workspace: 'workspace', baseRevision: 'base' }),
  );
  await f.project.list();
  late.reject(new Error('late transport failure'));
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(f.project.revision, null);
});

describe('editor project ownership', () => {
  it('retains saved copy identity and revisions through undo and conflicts', async () => {
    const f = fixture();
    await f.project.list();
    await f.project.edit((history) =>
      history.change((d) => {
        d.name = 'Edited';
      }),
    );
    await f.project.save('copy');
    assert.equal(f.project.revision, 'revision-1');
    assert.equal(f.project.dirty, false);
    assert.equal(f.documents.history.document.id, 'copy');
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

  it('keeps accepted history and file revision together when replacements fail', async () => {
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
    assert.deepEqual(f.documents.history.document, accepted);
    assert.equal(f.project.dirty, false);
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
  });
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

it('owns file identity from request admission through save acceptance', async () => {
  const f = fixture();
  await f.project.list();
  const result = Promise.withResolvers<Response>();
  f.respond(() => result.promise);
  const opening = f.project.open('file-existing');
  await assert.rejects(f.project.open('new'), /in progress/);
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
