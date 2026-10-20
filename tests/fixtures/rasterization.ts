import type { Page } from '@playwright/test';

// Serialize directly into an owned browser context. State-only integration
// retains real contexts, uploads, compilation and disposal; pixels belong to
// the separate renderer proofs and packaged native Game smoke.
export function suppressRasterization() {
  for (const name of ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced'])
    Object.defineProperty(WebGL2RenderingContext.prototype, name, {
      configurable: true,
      writable: true,
      value() {},
    });
}

export async function prepareStatePage(page: Page) {
  if (process.env.LANTERN_TEST_RASTERIZE === 'true') return;
  await page.addInitScript(suppressRasterization);
  // Do not interrupt Electron's awaited loadURL. Cover the active document as
  // soon as its modules load, plus all later HMR navigations via the init script.
  await page.waitForURL('**/index.html', { waitUntil: 'domcontentloaded' });
  await page.evaluate(suppressRasterization);
}
