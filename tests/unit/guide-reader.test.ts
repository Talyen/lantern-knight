import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readGuide } from '../../tools/read-guide';

test('guide lookup preserves nested sections and resolves the same anchors as documentation checks', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lantern-guide-'));
  try {
    await fs.writeFile(
      path.join(root, 'guide.md'),
      [
        '# Guide',
        '<!--\n## Commented\n-->',
        '## [Café](other.md) & checks',
        'Required policy.',
        '```md',
        '## Example heading',
        '```',
        '### Nested',
        'Nested policy.',
        '## Café & checks',
        'Second section.',
        'Last section',
        '------------',
        'Final policy.',
      ].join('\n'),
    );
    const outline = await readGuide('guide.md', root);
    assert.equal(
      outline,
      'guide.md\n1 #guide\n5 #café--checks\n10 #nested\n12 #café--checks-1\n14 #last-section',
    );
    const first = await readGuide('guide.md#caf%C3%A9--checks', root);
    assert.match(first, /^guide.md:5\n## \[Café\]/);
    assert.ok(first.includes('## Example heading'));
    assert.ok(first.endsWith('Nested policy.'));
    assert.doesNotMatch(first, /Second section/);
    assert.equal(
      await readGuide('guide.md#café--checks-1', root),
      'guide.md:12\n## Café & checks\nSecond section.',
    );
    assert.equal(
      await readGuide('guide.md#last-section', root),
      'guide.md:14\nLast section\n------------\nFinal policy.',
    );
    await assert.rejects(readGuide('guide.md#missing', root), /Unknown heading/);
    await fs.writeFile(path.join(root, 'data.json'), '{}');
    await assert.rejects(readGuide('data.json', root), /repository Markdown path/);
    await assert.rejects(readGuide('guide.md#nested#extra', root), /repository Markdown path/);
    await fs.mkdir(path.join(root, 'child'));
    await assert.rejects(
      readGuide('../guide.md', path.join(root, 'child')),
      /repository Markdown path/,
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
