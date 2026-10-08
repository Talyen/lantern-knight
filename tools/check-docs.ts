import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

function withoutComments(text: string) {
  return text.replace(/<!--[\s\S]*?-->/g, (match) => match.replace(/[^\n]/g, ' '));
}
function withoutFences(text: string) {
  let fence: { character: string; length: number } | undefined;
  return text
    .split('\n')
    .map((line) => {
      const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1];
      if (fence) {
        if (
          marker &&
          marker[0] === fence.character &&
          marker.length >= fence.length &&
          line.trim() === marker
        )
          fence = undefined;
        return ' '.repeat(line.length);
      }
      if (marker) {
        fence = { character: marker[0]!, length: marker.length };
        return ' '.repeat(line.length);
      }
      return line;
    })
    .join('\n');
}
function headingAnchors(text: string) {
  const anchors = new Set<string>(),
    lines = withoutFences(withoutComments(text)).split('\n');
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!,
      heading =
        /^\s{0,3}#{1,6}\s+(.+?)(?:\s+#+)?\s*$/.exec(line)?.[1] ??
        (line.trim() && /^\s{0,3}(?:=+|-+)\s*$/.test(lines[index + 1] ?? '')
          ? line.trim()
          : undefined);
    if (heading === undefined) continue;
    const base = heading
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/<[^>]*>/g, '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\p{M}_\-\s]/gu, '')
      .replace(/\s/g, '-');
    let anchor = base,
      suffix = 0;
    while (anchors.has(anchor)) anchor = base + '-' + ++suffix;
    anchors.add(anchor);
  }
  return anchors;
}
const referenceKey = (label: string) => label.trim().replace(/\s+/g, ' ').toLowerCase();
function markdownLinks(text: string) {
  const prose = withoutFences(text).replace(/(`+)[\s\S]*?\1/g, (match) =>
    match.replace(/[^\n]/g, ' '),
  );
  const destination = '(<[^>\\n]+>|(?:[^\\s()]|\\([^()\\n]*\\))+)',
    references = new Map<string, string>();
  for (const match of prose.matchAll(
    new RegExp('^ {0,3}\\[([^\\]\\n]+)\\]:\\s*' + destination, 'gm'),
  ))
    references.set(referenceKey(match[1]!), match[2]!);
  const links: { target: string; index: number }[] = [];
  for (const match of prose.matchAll(
    new RegExp(
      '!?\\[[^\\]\\n]*\\]\\(\\s*' + destination + '(?:\\s+["\\\'][^\\n]*?["\\\'])?\\s*\\)',
      'g',
    ),
  ))
    links.push({ target: match[1]!, index: match.index });
  for (const match of prose.matchAll(/!?\[([^\]\n]+)\](?:\[([^\]\n]*)\])?/g)) {
    if (
      prose[match.index + match[0].length] === '(' ||
      prose[match.index + match[0].length] === ':'
    )
      continue;
    const target = references.get(referenceKey(match[2] || match[1]!));
    if (target) links.push({ target, index: match.index });
    else if (match[2] !== undefined) links.push({ target: '', index: match.index });
  }
  return links;
}

export async function checkDocumentation(root: string, files: string[]) {
  const { scripts } = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8')) as {
    scripts: Record<string, string>;
  };
  const findings: string[] = [],
    anchors = new Map<string, Set<string>>(),
    realRoot = await fs.realpath(root),
    edges = new Map<string, Set<string>>();
  const requireInternal = (actual: string) => {
    const relative = path.relative(realRoot, actual);
    if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative))
      throw new Error('target is outside the repository');
  };
  for (const file of files) {
    const filename = path.resolve(root, file);
    let text: string;
    try {
      requireInternal(await fs.realpath(filename));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      findings.push(`${file}: ${(error as Error).message}`);
      continue;
    }
    text = withoutComments(await fs.readFile(filename, 'utf8'));
    const relativeFile = path.relative(root, filename).split(path.sep).join('/');
    // Reference provenance is an authored input, not a workflow document.
    const durable = /^[^/]+\.md$|^docs\/.*\.md$/i.test(relativeFile);
    if (durable) edges.set(relativeFile, new Set());
    const report = (index: number, message: string) =>
      findings.push(`${file}:${text.slice(0, index).split('\n').length}: ${message}`);
    for (const match of text.matchAll(/\bnpm\s+run(?:-script)?\s+(?:--\s+)?([\w:.-]+)/g))
      if (!Object.hasOwn(scripts, match[1]!)) report(match.index, `unknown npm script ${match[1]}`);
    for (const match of withoutFences(text).matchAll(/`([^`\n]+)`/g)) {
      const candidate = match[1]!;
      if (
        !/^(?:src|tests|tools|electron|authoring|assets|docs|references|\.github)\//.test(
          candidate,
        ) ||
        /[\s*<>|]/.test(candidate)
      )
        continue;
      const target = candidate.replace(/:\d+(?:-\d+)?$/, '');
      try {
        requireInternal(await fs.realpath(path.resolve(root, target)));
      } catch (error) {
        report(
          match.index,
          `invalid current file reference ${candidate}: ${(error as NodeJS.ErrnoException).code === 'ENOENT' ? 'target does not exist' : (error as Error).message}`,
        );
      }
    }
    for (const { target, index } of markdownLinks(text)) {
      if (!target) {
        report(index, 'undefined Markdown link reference');
        continue;
      }
      const href = target.startsWith('<') ? target.slice(1, -1) : target;
      if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(href)) continue;
      try {
        const [pathname, fragment] = href.split('#', 2),
          decoded = decodeURIComponent(pathname!.split('?', 1)[0]!);
        const resolved = decoded
          ? path.resolve(
              decoded.startsWith('/') ? root : path.dirname(filename),
              decoded.replace(/^\//, ''),
            )
          : filename;
        const actual = await fs.realpath(resolved);
        requireInternal(actual);
        if (durable && /\.md$/i.test(resolved))
          edges.get(relativeFile)!.add(path.relative(root, resolved).split(path.sep).join('/'));
        if (fragment && /\.md$/i.test(resolved)) {
          if (!anchors.has(actual))
            anchors.set(actual, headingAnchors(await fs.readFile(actual, 'utf8')));
          if (!anchors.get(actual)!.has(decodeURIComponent(fragment)))
            throw new Error('heading anchor does not exist');
        }
      } catch (error) {
        report(
          index,
          `invalid link ${href}: ${(error as NodeJS.ErrnoException).code === 'ENOENT' ? 'target does not exist' : (error as Error).message}`,
        );
      }
    }
  }
  const reachable = new Set(['README.md', 'AGENTS.md']),
    queue = [...reachable];
  while (queue.length) {
    for (const next of edges.get(queue.pop()!) ?? [])
      if (!reachable.has(next)) {
        reachable.add(next);
        queue.push(next);
      }
  }
  for (const file of edges.keys())
    if (!reachable.has(file))
      findings.push(`${file}: durable document is unreachable from README.md or AGENTS.md`);
  return findings;
}

async function main() {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const files = [
    ...new Set(
      execFileSync(
        'git',
        [
          '-c',
          'core.fsmonitor=false',
          '-c',
          'core.untrackedCache=false',
          'ls-files',
          '--cached',
          '--others',
          '--exclude-standard',
          '-z',
        ],
        { cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 },
      )
        .split('\0')
        .filter((file) => file.endsWith('.md')),
    ),
  ];
  const findings = await checkDocumentation(root, files);
  if (findings.length)
    throw new Error(
      `${findings.length} documentation issues:\n${findings.slice(0, 10).join('\n')}`,
    );
  console.log(
    `PASS: ${files.length} Markdown documents; links, anchors, npm scripts, current file references and durable document reachability checked.`,
  );
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
