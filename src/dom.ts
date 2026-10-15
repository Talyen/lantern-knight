type Content = string | number | Node | readonly Content[] | null | undefined | false;
const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!,
  );

// Only literal markup is parsed. Values stay text in both attributes and content;
// native node slots retain identity, listeners and the caller's lifetime ownership.
export function html<E extends HTMLElement = HTMLElement>(
  strings: TemplateStringsArray,
  ...values: Content[]
): E {
  const slots: Node[] = [];
  const render = (value: Content): string => {
    if (value === null || value === undefined || value === false) return '';
    if (Array.isArray(value)) return value.map(render).join('');
    if (typeof value === 'object') {
      slots.push(value as Node);
      return `<!--lantern-slot-${slots.length - 1}-->`;
    }
    return escape(String(value));
  };
  const template = document.createElement('template');
  template.innerHTML = strings.reduce(
    (markup, part, index) => markup + part + (index < values.length ? render(values[index]) : ''),
    '',
  );
  const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_COMMENT);
  const markers: Comment[] = [];
  while (walker.nextNode()) markers.push(walker.currentNode as Comment);
  let inserted = 0;
  for (const marker of markers) {
    const match = /^lantern-slot-(\d+)$/.exec(marker.data);
    if (match) {
      marker.replaceWith(slots[Number(match[1])]!);
      inserted++;
    }
  }
  if (inserted !== slots.length) throw new Error('DOM nodes require a content slot');
  if (template.content.childElementCount !== 1)
    throw new Error('DOM templates require one root element');
  return template.content.firstElementChild as E;
}
