if (import.meta.env.DEV) {
  const nav = document.createElement('nav');
  nav.ariaLabel = 'Developer tools';
  nav.style.cssText =
    'position:fixed;right:12px;bottom:12px;z-index:10000;background:#182125;padding:8px;border-radius:4px;display:flex;gap:12px;font:12px sans-serif';
  let pending = false;
  for (const [label, url, mode] of [
    ['Game', '/index.html', 'game'],
    ['Dev Preview', '/sandbox.html', 'sandbox'],
    ['Editor', '/editor.html', 'editor'],
  ] as const) {
    const link = document.createElement('a');
    link.textContent = label;
    link.href = url;
    link.style.color = '#e8dbc0';
    link.onclick = (event) => {
      const bridge = window.lantern;
      if (!bridge?.launchMode) return;
      event.preventDefault();
      if (pending) return;
      pending = true;
      bridge
        .launchMode(mode)
        .catch(console.error)
        .finally(() => {
          pending = false;
        });
    };
    nav.append(link);
  }
  document.body.append(nav);
}
