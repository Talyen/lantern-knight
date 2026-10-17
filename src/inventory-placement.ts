import { items } from './content/items';
import { packColumns, packRows, packFits, type PackEntry } from './core/pack';

// Each drawn pack owns one placement gesture. Redraw/closure aborts its listeners
// and preview; only the session command can commit a new position.
export function bindPackPlacement(
  grid: HTMLElement,
  entries: readonly Readonly<PackEntry>[],
  commit: (key: string, x: number, y: number) => void,
  select: (key: string) => void,
  announce: (message: string) => void,
  signal: AbortSignal,
) {
  const preview = document.createElement('div');
  preview.className = 'pack-placement';
  preview.hidden = true;
  preview.setAttribute('aria-hidden', 'true');
  grid.append(preview);
  let gesture:
    | {
        entry: Readonly<PackEntry>;
        x: number;
        y: number;
        keyboard: boolean;
        dx: number;
        dy: number;
      }
    | undefined;
  const controls = [...grid.querySelectorAll<HTMLButtonElement>('[data-entry]')];
  const control = (key: string) => controls.find((button) => button.dataset.entry === key);
  function cancel() {
    gesture = undefined;
    preview.hidden = true;
    for (const button of controls) button.classList.remove('moving');
  }
  function update() {
    if (!gesture) return;
    const { entry, x, y } = gesture,
      [width, height] = items[entry.item]!.footprint;
    preview.hidden = false;
    preview.style.gridArea = `${Math.max(0, Math.min(packRows - height, y)) + 1} / ${Math.max(0, Math.min(packColumns - width, x)) + 1} / span ${height} / span ${width}`;
    preview.classList.toggle('invalid', !packFits(entries, entry, x, y));
    control(entry.key)?.classList.add('moving');
  }
  function start(key: string) {
    if (signal.aborted) return;
    const entry = entries.find((entry) => entry.key === key);
    if (!entry) return;
    cancel();
    select(key);
    if (signal.aborted) return;
    gesture = { entry, x: entry.x, y: entry.y, keyboard: true, dx: 0, dy: 0 };
    control(key)?.focus({ preventScroll: true });
    update();
    announce('Arrow keys to move · Enter to place · Esc to cancel');
  }
  function place() {
    if (!gesture || signal.aborted) return;
    const { entry, x, y } = gesture;
    if (!packFits(entries, entry, x, y)) {
      announce('That space is blocked. Your item has not moved.');
      return;
    }
    cancel();
    commit(entry.key, x, y);
  }
  for (const button of controls) {
    button.draggable = true;
    button.addEventListener(
      'dragstart',
      (event) => {
        const entry = entries.find((entry) => entry.key === button.dataset.entry)!;
        const bounds = button.getBoundingClientRect(),
          cell = grid.getBoundingClientRect().width / packColumns;
        cancel();
        select(entry.key);
        gesture = {
          entry,
          x: entry.x,
          y: entry.y,
          keyboard: false,
          dx: Math.floor((event.clientX - bounds.left) / cell),
          dy: Math.floor((event.clientY - bounds.top) / cell),
        };
        event.dataTransfer!.setData('text/plain', entry.key);
        event.dataTransfer!.effectAllowed = 'move';
        update();
      },
      { signal },
    );
    button.addEventListener('dragend', cancel, { signal });
    button.addEventListener(
      'keydown',
      (event) => {
        if (event.altKey || event.ctrlKey || event.metaKey) return;
        if (!gesture && event.key.toLowerCase() === 'm') {
          event.preventDefault();
          event.stopPropagation();
          start(button.dataset.entry!);
          return;
        }
        if (!gesture?.keyboard) return;
        if (event.key === 'Enter') {
          event.preventDefault();
          event.stopImmediatePropagation();
          place();
          return;
        }
        const offsets: Record<string, [number, number]> = {
          ArrowLeft: [-1, 0],
          ArrowRight: [1, 0],
          ArrowUp: [0, -1],
          ArrowDown: [0, 1],
        };
        const offset = offsets[event.key];
        if (!offset) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        const [width, height] = items[gesture.entry.item]!.footprint;
        gesture.x = Math.max(0, Math.min(packColumns - width, gesture.x + offset[0]));
        gesture.y = Math.max(0, Math.min(packRows - height, gesture.y + offset[1]));
        update();
        preview.scrollIntoView({ block: 'nearest' });
        announce(
          `Column ${gesture.x + 1}, row ${gesture.y + 1} · ${packFits(entries, gesture.entry, gesture.x, gesture.y) ? 'Space available' : 'Blocked'}`,
        );
      },
      { signal },
    );
  }
  grid.addEventListener(
    'dragover',
    (event) => {
      if (!gesture || gesture.keyboard) return;
      event.preventDefault();
      const bounds = grid.getBoundingClientRect(),
        cell = bounds.width / packColumns;
      gesture.x = Math.floor((event.clientX - bounds.left) / cell) - gesture.dx;
      gesture.y = Math.floor((event.clientY - bounds.top) / cell) - gesture.dy;
      event.dataTransfer!.dropEffect = packFits(entries, gesture.entry, gesture.x, gesture.y)
        ? 'move'
        : 'none';
      update();
      const scroll = grid.parentElement!;
      const viewport = scroll.getBoundingClientRect();
      if (event.clientY > viewport.bottom - 30) scroll.scrollTop += 12;
      else if (event.clientY < viewport.top + 30) scroll.scrollTop -= 12;
    },
    { signal },
  );
  grid.addEventListener(
    'drop',
    (event) => {
      event.preventDefault();
      if (gesture && !gesture.keyboard) {
        place();
        cancel();
      }
    },
    { signal },
  );
  signal.addEventListener('abort', cancel, { once: true });
  return {
    start,
    cancel,
    get moving() {
      return !!gesture;
    },
  };
}
