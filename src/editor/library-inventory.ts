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
  const summary = document.createElement('p');
  summary.textContent = `${data.files.length.toLocaleString()} source files · ${data.images.length.toLocaleString()} distinct images · ${data.media.length.toLocaleString()} media files`;
  const search = document.createElement('input');
  search.type = 'search';
  search.placeholder = 'Search sources and media…';
  search.setAttribute('aria-label', 'Search source inventory');
  const list = document.createElement('div'),
    count = document.createElement('p'),
    more = document.createElement('button');
  more.textContent = 'Show more';
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
      const item = document.createElement('p'),
        label = document.createElement('span');
      label.textContent = row.path + ' ';
      item.append(label);
      if (row.assets[0]) {
        const button = document.createElement('button');
        button.textContent = 'Show artwork';
        button.onclick = () => show(row.assets[0]!);
        item.append(button);
      }
      if (
        row.media &&
        /^generated\/library\/media\/[a-f0-9]{64}\.[a-z0-9]+$/.test(row.media.file)
      ) {
        const link = document.createElement('a');
        link.href = '/' + row.media.file;
        link.download = row.media.path.split('/').at(-1) ?? 'asset';
        link.textContent = 'Download original';
        item.append(link);
        const ext = row.media.file.split('.').at(-1);
        if (
          ['mp4', 'webm', 'wav', 'mp3', 'ogg', 'gif', 'apng', 'png', 'webp', 'svg'].includes(ext!)
        ) {
          const details = document.createElement('details'),
            title = document.createElement('summary');
          title.textContent = 'Preview';
          details.append(title);
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
  if (data.unresolvedAnimations.length) {
    const details = document.createElement('details'),
      title = document.createElement('summary');
    title.textContent = `${data.unresolvedAnimations.length} metadata records need animation adapters`;
    details.append(title);
    const note = document.createElement('p');
    note.textContent =
      'Their supplied images and media remain available. These metadata records could not establish a complete playable animation.';
    details.append(note);
    for (const issue of data.unresolvedAnimations) {
      const row = document.createElement('p');
      row.textContent = `${issue.archive} / ${issue.metadata}: ${issue.reason}`;
      details.append(row);
    }
    host.append(details);
  }
  render();
}
