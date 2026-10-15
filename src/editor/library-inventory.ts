import { html } from '../dom';
type RecordEntry = { path: string; sha256: string; kind: string; assets: string[] };
type Media = { path: string; file: string; sha256: string; bytes: number };
type Inventory = {
  files: RecordEntry[];
  images: unknown[];
  media: Media[];
  unresolvedAnimations: { archive: string; metadata: string; reason: string }[];
};

/** Source inventory is prepared data; opening the editor never scans external storage. */
export async function libraryInventory(
  host: HTMLElement,
  signal: AbortSignal,
  show: (id: string) => void,
) {
  const response = await fetch('/generated/library/inventory.json', { signal });
  if (response.status === 404) {
    host.textContent = 'Prepare the library to view its source inventory.';
    return;
  }
  if (!response.ok) throw new Error('Library inventory unavailable');
  const data = (await response.json()) as Inventory;
  const summary = html`<p>${data.files.length.toLocaleString()} source files · ${data.images.length.toLocaleString()} distinct images · ${data.media.length.toLocaleString()} media files</p>`;
  const search = html<HTMLInputElement>`<input type="search" placeholder="Search sources and media…" aria-label="Search source inventory">`;
  const list = html`<div></div>`,
    count = html`<p></p>`,
    more = html<HTMLButtonElement>`<button>Show more</button>`;
  const byHash = new Map(data.media.map((m) => [m.sha256, m]));
  const loose = new Set(data.files.map((r) => r.sha256));
  const rows = [
    ...data.files.map((r) => ({ ...r, media: byHash.get(r.sha256) })),
    ...data.media
      .filter((m) => !loose.has(m.sha256))
      .map((media) => ({
        path: media.path,
        sha256: media.sha256,
        kind: 'media',
        assets: [] as string[],
        media,
      })),
  ];
  const activeMedia = new Set<HTMLMediaElement>();
  const stopMedia = () => {
    for (const element of activeMedia) {
      element.pause();
      element.removeAttribute('src');
      element.load();
    }
    activeMedia.clear();
  };
  signal.addEventListener('abort', stopMedia, { once: true });
  let limit = 50;
  const render = () => {
    stopMedia();
    list.replaceChildren();
    const query = search.value.toLocaleLowerCase(),
      matches = rows.filter((r) => r.path.toLocaleLowerCase().includes(query));
    count.textContent = `Showing ${Math.min(limit, matches.length).toLocaleString()} of ${matches.length.toLocaleString()}`;
    for (const row of matches.slice(0, limit)) {
      const item = html`<p><span>${row.path} </span></p>`;
      if (row.assets[0]) {
        const button = html<HTMLButtonElement>`<button>Show artwork</button>`;
        button.onclick = () => show(row.assets[0]!);
        item.append(button);
      }
      if (
        row.media &&
        /^generated\/library\/media\/[a-f0-9]{64}\.[a-z0-9]+$/.test(row.media.file)
      ) {
        item.append(
          html`<a href="/${row.media.file}" download="${row.media.path.split('/').at(-1) ?? 'asset'}">Download original</a>`,
        );
        const ext = row.media.file.split('.').at(-1);
        if (
          ['mp4', 'webm', 'wav', 'mp3', 'ogg', 'gif', 'apng', 'png', 'webp', 'svg'].includes(ext!)
        ) {
          const details = html<HTMLDetailsElement>`<details><summary>Preview</summary></details>`;
          details.ontoggle = () => {
            if (!details.open) return;
            if (details.children.length > 1) return;
            const element = document.createElement(
              ['mp4', 'webm'].includes(ext!)
                ? 'video'
                : ['wav', 'mp3', 'ogg'].includes(ext!)
                  ? 'audio'
                  : 'img',
            );
            element.src = '/' + row.media!.file;
            element.style.maxWidth = '100%';
            if (element instanceof HTMLMediaElement) {
              element.controls = true;
              element.preload = 'none';
              activeMedia.add(element);
            } else element.alt = row.path;
            details.append(element);
          };
          item.append(details);
        }
      }
      list.append(item);
    }
    more.hidden = limit >= matches.length;
  };
  search.oninput = () => {
    limit = 50;
    render();
  };
  more.onclick = () => {
    limit += 50;
    render();
  };
  host.append(summary, search, count, list, more);
  if (data.unresolvedAnimations.length)
    host.append(html`<details>
      <summary>${data.unresolvedAnimations.length} metadata records need animation adapters</summary>
      <p>Their supplied images and media remain available. These metadata records could not establish a complete playable animation.</p>
      ${data.unresolvedAnimations.map((issue) => html`<p>${issue.archive} / ${issue.metadata}: ${issue.reason}</p>`)}
    </details>`);
  render();
}
