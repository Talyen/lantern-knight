import test from 'node:test';
import assert from 'node:assert/strict';
import { runProcess } from '../../tools/run-process';
test('cancellation terminates the owned process tree and does not hold the caller open', async () => {
  const controller = new AbortController();
  let output = '';
  const run = runProcess(
    process.execPath,
    [
      '-e',
      "const {spawn}=require('node:child_process');const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'inherit'});console.log(child.pid);setInterval(()=>{},1000);",
    ],
    {
      cwd: process.cwd(),
      signal: controller.signal,
      output: (chunk) => {
        output += chunk.toString();
      },
    },
  );
  const deadline = Date.now() + 5000;
  while (!Number(output.trim())) {
    if (Date.now() > deadline) throw new Error('Child did not start');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  controller.abort();
  await assert.rejects(run, /cancelled/);
  const pid = Number(output.trim());
  for (let n = 0; n < 100; n++) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      assert.equal((error as NodeJS.ErrnoException).code, 'ESRCH');
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail('Owned child survived cancellation');
});
