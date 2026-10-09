import {
  assetClosure,
  assetLabel,
  loadAssetIndex,
  matchesAsset,
  type AssetScope,
  type AssetFilter,
} from '../assets/asset-browser';
import type { AssetRuntime } from '../assets/loader';
import { fixtureAssetRoots, usedAssetRoots } from '../content/asset-usage';
export function bindAssetPicker(
  runtime: AssetRuntime,
  signal: AbortSignal,
  area: () => string,
  select: (id: string) => Promise<void>,
  preference: AssetFilter,
) {
  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  let current = 'ink-hero-current';
  let index: Awaited<ReturnType<typeof loadAssetIndex>> | undefined;
  let pending: Promise<void> | undefined;
  $<HTMLInputElement>('asset-animated').checked = preference.animated;
  $<HTMLSelectElement>('asset-scope').value = preference.scope;
  $<HTMLSelectElement>('asset-type').value = preference.type;
  $<HTMLInputElement>('asset-search').value = preference.search;
  function refresh() {
    if (!index || signal.aborted) return;
    const filter = {
      scope: $<HTMLSelectElement>('asset-scope').value as AssetScope,
      animated: $<HTMLInputElement>('asset-animated').checked,
      type: $<HTMLSelectElement>('asset-type').value as AssetFilter['type'],
      search: $<HTMLInputElement>('asset-search').value,
    };
    Object.assign(preference, filter);
    const used = assetClosure(usedAssetRoots(), index),
      scene = assetClosure(fixtureAssetRoots(area()), index);
    const entries = [...index.values()]
      .filter((m) => matchesAsset(m, filter, used, scene))
      .sort(
        (a, b) =>
          assetLabel(a).localeCompare(assetLabel(b)) || a.asset.id.localeCompare(b.asset.id),
      );
    const options = $<HTMLSelectElement>('asset');
    options.replaceChildren();
    for (const entry of entries) options.add(new Option(assetLabel(entry), entry.asset.id));
    options.value = current;
    options.disabled = entries.length === 0;
    $('asset-count').textContent =
      `${entries.length} ${filter.animated ? 'animated ' : ''}assets${entries.some((m) => m.asset.id === current) ? '' : ' · current preview outside filter'}`;
  }
  for (const id of ['asset-scope', 'asset-type', 'asset-animated']) $(id).onchange = refresh;
  $('asset-search').oninput = refresh;
  $('asset').onchange = () => {
    const id = $<HTMLSelectElement>('asset').value;
    void select(id).catch((error) => {
      if (!signal.aborted) $('asset-count').textContent = error.message;
    });
  };
  function load() {
    if (!pending) {
      $('asset-count').textContent = 'Loading assets…';
      pending = loadAssetIndex(runtime, signal)
        .then((value) => {
          index = value;
          refresh();
        })
        .catch((error) => {
          pending = undefined;
          if (!signal.aborted) $('asset-count').textContent = error.message + ' · reopen to retry';
          throw error;
        });
    }
    return pending;
  }
  return {
    load,
    refresh,
    selected(id: string) {
      current = id;
      refresh();
    },
  };
}
