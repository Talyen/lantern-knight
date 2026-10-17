// One mounted tooltip serves icon controls, including controls in native dialogs.
export function bindPlayerTooltips(root: HTMLElement, signal: AbortSignal) {
  const tip = document.createElement('div');
  tip.className = 'player-tooltip';
  tip.id = 'player-tooltip';
  tip.role = 'tooltip';
  tip.popover = 'manual';
  root.append(tip);
  let active: HTMLElement | undefined;
  let hovered: HTMLElement | undefined;
  let focused: HTMLElement | undefined;
  function hide() {
    if (active) {
      const ids = active
        .getAttribute('aria-describedby')
        ?.split(' ')
        .filter((id) => id !== tip.id);
      if (ids?.length) active.setAttribute('aria-describedby', ids.join(' '));
      else active.removeAttribute('aria-describedby');
    }
    active = undefined;
    if (tip.isConnected && tip.matches(':popover-open')) tip.hidePopover();
    root.append(tip);
  }
  function update() {
    hide();
    const control = focused ?? hovered;
    if (
      !root.isConnected ||
      !control?.isConnected ||
      !control.getClientRects().length ||
      !control.dataset.tip
    )
      return;
    // A modal makes elements outside it inert, including other top-layer popovers.
    (control.closest('dialog[open]') ?? root).append(tip);
    active = control;
    tip.textContent = control.dataset.tip;
    control.setAttribute(
      'aria-describedby',
      [control.getAttribute('aria-describedby'), tip.id].filter(Boolean).join(' '),
    );
    tip.showPopover();
    const box = control.getBoundingClientRect();
    const bounds = tip.getBoundingClientRect();
    tip.style.left =
      Math.max(
        8,
        Math.min(innerWidth - bounds.width - 8, box.left + (box.width - bounds.width) / 2),
      ) + 'px';
    tip.style.top =
      (box.top >= bounds.height + 12
        ? box.top - bounds.height - 8
        : Math.min(innerHeight - bounds.height - 8, box.bottom + 8)) + 'px';
  }
  function trigger(target: EventTarget | null) {
    return target instanceof Element
      ? (target.closest<HTMLElement>('[data-tip]') ?? undefined)
      : undefined;
  }
  root.addEventListener(
    'pointerover',
    (event) => {
      const next = trigger(event.target);
      if (next === hovered) return;
      hovered = next;
      update();
    },
    { signal },
  );
  root.addEventListener(
    'pointerout',
    (event) => {
      if (trigger(event.relatedTarget) === hovered) return;
      hovered = trigger(event.relatedTarget);
      update();
    },
    { signal },
  );
  root.addEventListener(
    'focusin',
    (event) => {
      focused = trigger(event.target);
      update();
    },
    { signal },
  );
  root.addEventListener(
    'focusout',
    () => {
      focused = undefined;
      hide();
    },
    { signal },
  );
  root.addEventListener('click', hide, { signal });
  root.addEventListener('scroll', hide, { capture: true, signal });
  window.addEventListener('resize', hide, { signal });
  window.addEventListener('blur', hide, { signal });
  document.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Escape') hide();
    },
    { capture: true, signal },
  );
  signal.addEventListener(
    'abort',
    () => {
      hide();
      tip.remove();
    },
    { once: true },
  );
}
