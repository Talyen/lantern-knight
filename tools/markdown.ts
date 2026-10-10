export function withoutComments(text: string) {
  return text.replace(/<!--[\s\S]*?-->/g, (match) => match.replace(/[^\n]/g, ' '));
}

export function withoutFences(text: string) {
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

export function markdownHeadings(text: string) {
  const anchors = new Set<string>(),
    headings: { anchor: string; level: number; line: number }[] = [],
    lines = withoutFences(withoutComments(text)).split('\n');
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!,
      atx = /^\s{0,3}(#{1,6})\s+(.+?)(?:\s+#+)?\s*$/.exec(line),
      setext = /^\s{0,3}(=+|-+)\s*$/.exec(lines[index + 1] ?? ''),
      heading = atx?.[2] ?? (line.trim() && setext ? line.trim() : undefined);
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
    headings.push({
      anchor,
      level: atx ? atx[1]!.length : setext![1]![0] === '=' ? 1 : 2,
      line: index + 1,
    });
  }
  return headings;
}
