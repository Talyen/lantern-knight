import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { projectRoot } from './assets/paths';
import { markdownHeadings } from './markdown';

export async function readGuide(reference: string, root = projectRoot) {
  const [file, fragment, extra] = reference.split('#'),
    filename = path.resolve(root, file!),
    relative = path.relative(await fs.realpath(root), await fs.realpath(filename));
  if (
    !file?.endsWith('.md') ||
    extra !== undefined ||
    relative === '..' ||
    relative.startsWith('..' + path.sep) ||
    path.isAbsolute(relative)
  )
    throw new Error('Use a repository Markdown path with an optional #heading anchor');
  const text = await fs.readFile(filename, 'utf8'),
    headings = markdownHeadings(text);
  if (fragment === undefined)
    return [relative, ...headings.map(({ anchor, line }) => `${line} #${anchor}`)].join('\n');
  const index = headings.findIndex(({ anchor }) => anchor === decodeURIComponent(fragment));
  if (index < 0)
    throw new Error(`Unknown heading ${reference}; list anchors with docs:read -- ${file}`);
  const heading = headings[index]!,
    next = headings.slice(index + 1).find(({ level }) => level <= heading.level),
    section = text.split('\n').slice(heading.line - 1, next ? next.line - 1 : undefined);
  return `${relative}:${heading.line}\n${section.join('\n').trimEnd()}`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const references = process.argv.slice(2);
  if (!references.length) {
    console.error('Use docs:read -- <file.md[#heading]>...; omit #heading to list anchors');
    process.exitCode = 1;
  } else
    Promise.all(references.map((reference) => readGuide(reference)))
      .then((sections) => console.log(sections.join('\n\n')))
      .catch((error) => {
        console.error(error.message);
        process.exitCode = 1;
      });
}
