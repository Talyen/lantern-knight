import { spawn } from 'node:child_process';
import { chromium } from '@playwright/test';

// Release fuses disable Playwright's main-process inspector. Attach only to
// Chromium, exercising the unmodified hardened executable and real Bridge.
export async function launchPackaged(executable: string, profile: string, args: string[] = []) {
  const child = spawn(executable, ['--remote-debugging-port=0', ...args], {
    env: {
      ...process.env,
      LANTERN_USER_DATA: profile,
      LANTERN_AUTOMATED_RUN: '1',
      LANTERN_TEST_HIDDEN: '1',
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  const exited = new Promise<number | null>((resolve) => child.once('close', resolve));
  const stop = async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    const deadline = setTimeout(() => child.kill('SIGKILL'), 5000);
    try {
      await exited;
    } finally {
      clearTimeout(deadline);
    }
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  let log = '';
  try {
    const endpoint = await new Promise<string>((resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error('Native debugging endpoint unavailable: ' + log)),
        30_000,
      );
      child.once('error', reject);
      child.once('exit', (code) =>
        reject(new Error(`Native application exited (${code}): ${log}`)),
      );
      child.stderr.on('data', (chunk: Buffer) => {
        log = (log + chunk.toString()).slice(-8192);
        const match = /DevTools listening on (ws:\/\/[^\s]+)/.exec(log);
        if (match) resolve(match[1]!);
      });
    });
    clearTimeout(timer);
    const browser = await chromium.connectOverCDP(endpoint);
    const context = browser.contexts()[0]!;
    const page = context.pages()[0] ?? (await context.waitForEvent('page'));
    return {
      page,
      async close() {
        try {
          if (child.exitCode === null && child.signalCode === null) {
            await page.close({ runBeforeUnload: true });
            await Promise.race([
              exited,
              new Promise<never>((_resolve, reject) => {
                timer = setTimeout(
                  () => reject(new Error('Native application did not close: ' + log)),
                  10_000,
                );
              }),
            ]);
            if (child.exitCode !== 0) throw new Error('Native application failed: ' + log);
          }
        } finally {
          clearTimeout(timer);
          await stop();
          await browser.close();
        }
      },
    };
  } catch (error) {
    clearTimeout(timer);
    await stop();
    throw error;
  }
}
