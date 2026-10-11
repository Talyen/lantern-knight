import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { readGuide, searchGuides } from '../../tools/read-guide';

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
      'guide.md\n1 #guide (16 lines)\n5   #café--checks (7 lines)\n10     #nested (2 lines)\n12   #café--checks-1 (2 lines)\n14   #last-section (3 lines)',
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

test('bounded guide reads and search expose continuations without losing policy or crawling references', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lantern-guide-'));
  try {
    const policies = Array.from(
        { length: 100 },
        (_, index) => `Policy ${index}: ${'x'.repeat(180)}`,
      ),
      text = ['# Policy', ...policies, '## Final policy', 'Keep original sources.'].join('\n');
    await fs.mkdir(path.join(root, 'docs'));
    await fs.mkdir(path.join(root, 'references'));
    await fs.writeFile(path.join(root, 'docs/policy.md'), text);
    await fs.writeFile(path.join(root, 'references/bulk.md'), '# Source\nKeep original sources.');
    await fs.writeFile(path.join(root, '.gitignore'), 'docs/ignored.md\n');
    await fs.writeFile(path.join(root, 'docs/ignored.md'), '# Ignored\nKeep original sources.');
    execFileSync('git', ['init', '--quiet'], { cwd: root });
    const first = await readGuide('docs/policy.md#policy', root),
      offset = Number(/--offset (\d+)/.exec(first)![1]),
      second = await readGuide('docs/policy.md#policy', root, { offset });
    assert.ok(first.length < 12500);
    assert.ok(offset > 0 && offset < 80, 'character budget can stop before the line limit');
    assert.equal(
      first.split('\n\nMore:')[0]!.split('\n').slice(1).join('\n') +
        '\n' +
        second.split('\n').slice(1).join('\n'),
      text,
    );
    assert.match(second, new RegExp(`^docs/policy.md:${offset + 1}\\n`));
    assert.equal(
      await readGuide('docs/policy.md#policy', root, { full: true }),
      `docs/policy.md:1\n${text}`,
    );
    await assert.rejects(readGuide('docs/policy.md#policy', root, { offset: -1 }), /Offset/);
    await assert.rejects(readGuide('docs/policy.md#policy', root, { offset: 200 }), /Offset/);
    assert.equal(
      await searchGuides('ORIGINAL SOURCES', [], root),
      '1 matching sections:\ndocs/policy.md#final-policy (line 103)\n  Keep original sources.',
    );
    assert.match(
      await searchGuides('original sources', ['references/bulk.md'], root),
      /references\/bulk.md#source/,
    );
    await assert.rejects(searchGuides(' ', [], root), /must not be empty/);

    await fs.writeFile(
      path.join(root, 'docs/search.md'),
      Array.from(
        { length: 14 },
        (_, index) => `## Rule ${index}\nPreserve sources.\nPreserve sources again.`,
      ).join('\n'),
    );
    const matches = await searchGuides('preserve sources', [], root);
    assert.match(matches, /^14 matching sections:/);
    assert.match(matches, /--offset 12/);
    assert.doesNotMatch(matches, /#rule-12/);
    assert.match(await searchGuides('preserve sources', [], root, { offset: 12 }), /#rule-13/);
    assert.match(await searchGuides('preserve sources', [], root, { full: true }), /#rule-13/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
