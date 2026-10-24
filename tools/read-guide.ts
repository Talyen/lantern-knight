import { runCli } from './cli';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { projectRoot } from './assets/paths';
import { markdownHeadings, withoutComments } from './markdown';

type ReadOptions = { offset?: number; full?: boolean };
const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";

function page(entries: string[], options: ReadOptions, command: string, limit = 80) {
  const offset = options.offset ?? 0;
  if (!Number.isSafeInteger(offset) || offset < 0 || (offset && offset >= entries.length))
    throw new Error('Offset must select an available line or search result');
  let end = offset,
    characters = 0;
  while (end < entries.length) {
    const size = entries[end]!.length + 1;
    if (!options.full && (end - offset >= limit || characters + size > 12000)) break;
    characters += size;
    end++;
  }
  if (end === offset && entries.length)
    throw new Error('Entry exceeds the output budget; select a smaller section or use --full');
  return (
    entries.slice(offset, end).join('\n').trimEnd() +
    (end < entries.length
      ? `\n\nMore: ${command} --offset ${end} (${entries.length - end} remaining; --full reads all)`
      : '')
  );
}

async function loadGuide(reference: string, root: string) {
  const [file, fragment, extra] = reference.split('#'),
    filename = path.resolve(root, file!);
  if (!file?.endsWith('.md') || extra !== undefined)
    throw new Error('Use a repository Markdown path with an optional #heading anchor');
  const relative = path.relative(await fs.realpath(root), await fs.realpath(filename));
  if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative))
    throw new Error('Use a repository Markdown path with an optional #heading anchor');
  const text = await fs.readFile(filename, 'utf8'),
    headings = markdownHeadings(text);
  return { file, fragment, relative: relative.split(path.sep).join('/'), text, headings };
}

export async function readGuide(reference: string, root = projectRoot, options: ReadOptions = {}) {
  const { file, fragment, relative, text, headings } = await loadGuide(reference, root),
    lines = text.split('\n'),
    command = `npm run --silent docs:read -- ${quote(reference)}`;
  if (fragment === undefined)
    return (
      relative +
      '\n' +
      page(
        headings.map(({ anchor, line, level }, index) => {
          const next = headings.slice(index + 1).find((heading) => heading.level <= level);
          return `${line} ${'  '.repeat(level - 1)}#${anchor} (${(next?.line ?? lines.length + 1) - line} lines)`;
        }),
        options,
        command,
      )
    );
  const index = headings.findIndex(({ anchor }) => anchor === decodeURIComponent(fragment));
  if (index < 0)
    throw new Error(`Unknown heading ${reference}; list anchors with docs:read -- ${file}`);
  const heading = headings[index]!,
    next = headings.slice(index + 1).find(({ level }) => level <= heading.level),
    section = lines.slice(heading.line - 1, next ? next.line - 1 : undefined);
  return `${relative}:${heading.line + (options.offset ?? 0)}\n${page(section, options, command)}`;
}

export async function searchGuides(
  query: string,
  references: string[] = [],
  root = projectRoot,
  options: ReadOptions = {},
) {
  if (!query.trim()) throw new Error('Search text must not be empty');
  const files = references.length
    ? [...references]
    : [
        ...new Set(
          execFileSync(
            'git',
            [
              'ls-files',
              '--cached',
              '--others',
              '--exclude-standard',
              '-z',
              '--',
              '*.md',
              ':(exclude)asset-data/**',
            ],
            { cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 ** 2 },
          ).split('\0'),
        ),
      ].filter((file) =>
        /^[^/]+\.md$|^docs\/.*\.md$|^\.agents\/skills\/(?:README\.md|[^/]+\/SKILL\.md)$/.test(file),
      );
  const matches: { text: string; headingMatch: boolean }[] = [],
    needle = query.toLowerCase();
  for (const reference of files.sort()) {
    const guide = await loadGuide(reference, root).catch((error: NodeJS.ErrnoException) => {
      if (!references.length && error.code === 'ENOENT') return undefined;
      throw error;
    });
    if (!guide) continue;
    if (guide.fragment !== undefined)
      throw new Error('Search accepts Markdown paths without anchors');
    const seen = new Set<string>();
    for (const [index, line] of withoutComments(guide.text).split('\n').entries()) {
      const found = line.toLowerCase().indexOf(needle);
      if (found < 0) continue;
      const heading = guide.headings.filter((heading) => heading.line <= index + 1).at(-1);
      if (!heading) continue;
      const target = guide.relative + '#' + heading.anchor;
      if (seen.has(target)) continue;
      seen.add(target);
      const start = Math.max(0, found - 60),
        excerpt = line
          .slice(start, start + 180)
          .trim()
          .replace(/\s+/g, ' ');
      matches.push({
        text: `${target} (line ${index + 1})\n  ${start ? '…' : ''}${excerpt}${start + 180 < line.length ? '…' : ''}`,
        headingMatch: heading.line === index + 1,
      });
    }
  }
  const command = `npm run --silent docs:read -- --search ${quote(query)}${references.map((reference) => ' ' + quote(reference)).join('')}`;
  const results = page(
    matches
      .sort((a, b) => Number(b.headingMatch) - Number(a.headingMatch))
      .map((match) => match.text),
    options,
    command,
    12,
  );
  return matches.length
    ? `${matches.length} matching sections:\n${results}`
    : 'No guide sections match ' + quote(query);
}

async function main() {
  const { values, positionals } = parseArgs({
    options: { search: { type: 'string' }, offset: { type: 'string' }, full: { type: 'boolean' } },
    allowPositionals: true,
  });
  const options = {
    offset: values.offset === undefined ? 0 : Number(values.offset),
    full: values.full,
  };
  if (values.search !== undefined)
    console.log(await searchGuides(values.search, positionals, projectRoot, options));
  else {
    if (!positionals.length)
      throw new Error(
        'Use docs:read -- <file.md[#heading]>... [--offset N | --full], or --search <text> [file.md...]',
      );
    console.log(
      (
        await Promise.all(
          positionals.map((reference) => readGuide(reference, projectRoot, options)),
        )
      ).join('\n\n'),
    );
  }
}
runCli(import.meta.url, () => main(), 'message');
