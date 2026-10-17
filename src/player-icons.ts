// Small control glyphs accompany the library's illustrated item artwork.
const paths = {
  mouse: '<rect x="6" y="2" width="12" height="20" rx="6"/><path d="M12 2v8M6 10h12"/>',
  bag: '<path d="M8 6V4h8v2M6 7h12l2 13H4L6 7Z"/><path d="M8 12h8v5H8zM9 7v3m6-3v3"/>',
  settings:
    '<path d="m10 3-.7 3-2 .9-2.8-1-2 3.4L5 11v2l-2.5 1.7 2 3.4 2.8-1 2 .9.7 3h4l.7-3 2-.9 2.8 1 2-3.4L19 13v-2l2.5-1.7-2-3.4-2.8 1-2-.9-.7-3Z"/><circle cx="12" cy="12" r="3"/>',
  sound: '<path d="M4 9h4l5-4v14l-5-4H4zM16 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',
  display: '<path d="M3 4h18v13H3zM8 21h8m-4-4v4"/>',
  controls: '<path d="M2 7h20v12H2zM5 10h1m3 0h1m3 0h1m3 0h2M5 13h1m3 0h1m3 0h1m3 0h2M6 16h12"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  back: '<path d="m10 5-7 7 7 7M3 12h18"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  sword: '<path d="m15 3 6 0 0 6L8 20l-4-4L15 3ZM11 13l3 3M3 21l4-4M3 14l7 7"/>',
  lantern: '<path d="M9 5V3h6v2M7 8h10l2 13H5L7 8ZM5 8h14M8 5h8M9 12v6m6-6v6"/>',
  potion: '<path d="M9 3h6M10 3v5L5 17q-2 4 3 4h8q5 0 3-4l-5-9V3M8 15h8"/>',
  move: '<path d="M12 2v20M2 12h20M8 6l4-4 4 4M8 18l4 4 4-4M6 8l-4 4 4 4m12-8 4 4-4 4"/>',
  aim: '<circle cx="12" cy="12" r="7"/><path d="M12 1v6m0 10v6M1 12h6m10 0h6"/>',
  dodge: '<path d="M12 3h6l-1 9 5 4v5H9l-2-4 5-4V3ZM2 7h6M1 12h5M2 17h3"/>',
  hand: '<path d="M8 13V5a2 2 0 0 1 4 0v6-8a2 2 0 0 1 4 0v8-5a2 2 0 0 1 4 0v9q0 6-6 6h-3q-2 0-4-3l-4-5q-1-3 2-3l3 3Z"/>',
  pause: '<path d="M6 4h4v16H6zM14 4h4v16h-4z"/>',
  fire: '<path d="M12 2q1 7 6 9 4 3 1 7-6 6-13 1-5-4 1-10 0 5 3 5-1-5 2-12ZM4 22l16-2M4 20l16 2"/>',
  waypoint: '<path d="M19 9q0 6-7 13Q5 15 5 9a7 7 0 1 1 14 0Z"/><circle cx="12" cy="9" r="2"/>',
  reset: '<path d="M4 10a8 8 0 1 1 1 8M4 3v7h7"/>',
  heart: '<path d="M12 21 3 12C-2 5 7 0 12 6c5-6 14-1 9 6Z"/>',
} as const;

export function playerIcon(name: keyof typeof paths) {
  return `<svg class="player-icon" data-player-icon="${name}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths[name]}</svg>`;
}

export function createPlayerIcon(name: keyof typeof paths) {
  const template = document.createElement('template');
  template.innerHTML = playerIcon(name);
  return template.content.firstElementChild as SVGElement;
}
