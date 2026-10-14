import test from 'node:test';
import assert from 'node:assert/strict';
import { macSigning, notarizeMacApp } from '../../tools/package-mac';
import type { runProcess } from '../../tools/run-process';

const identity = 'Developer ID Application: Example Studio (ABCDEFGHIJ)';
const signed = { platform: 'mac' as const, signed: true, identity, 'notary-profile': 'example' };

test('release signing rejects development identities and unsupported modes before packaging', () => {
  assert.equal(macSigning({ platform: 'mac' }, 'darwin'), undefined);
  assert.deepEqual(macSigning(signed, 'darwin'), { identity, keychainProfile: 'example' });
  for (const options of [
    { ...signed, platform: 'win' as const },
    { ...signed, dev: true },
    { ...signed, local: true },
    { ...signed, identity: 'Apple Development: Example Studio (ABCDEFGHIJ)' },
    { ...signed, identity: '-' },
    { ...signed, 'notary-profile': '' },
    { ...signed, signed: false },
  ])
    assert.throws(() => macSigning(options, 'darwin'));
  assert.throws(() => macSigning(signed, 'win32'));
});

test('rejected or malformed Apple responses cannot advance to stapling or Gatekeeper acceptance', async () => {
  for (const response of [
    JSON.stringify({ id: 'submission', status: 'Invalid' }),
    '{}',
    'invalid json',
  ]) {
    const commands: string[] = [];
    const run: typeof runProcess = async (command, args, options) => {
      commands.push([command, ...args.slice(0, 2)].join(' '));
      if (command === 'xcrun' && args[0] === 'notarytool') options.output?.(Buffer.from(response));
    };
    await assert.rejects(notarizeMacApp(macSigning(signed, 'darwin')!, '/example', run));
    assert.equal(commands.length, 3);
    assert.ok(
      commands.every((command) => !command.includes('stapler') && !command.startsWith('spctl')),
    );
  }
});

test('release verification stops at a failing stage and requires ticket and Gatekeeper checks', async () => {
  for (const failure of ['codesign', 'ditto', 'submit', 'staple', 'validate', 'spctl', undefined]) {
    const stages: string[] = [];
    const run: typeof runProcess = async (command, args, options) => {
      const stage = command === 'xcrun' ? args[1]! : command;
      stages.push(stage);
      if (stage === failure) throw new Error('fixture failure');
      if (stage === 'submit')
        options.output?.(Buffer.from(JSON.stringify({ id: 'submission', status: 'Accepted' })));
    };
    const operation = notarizeMacApp(macSigning(signed, 'darwin')!, '/example', run);
    if (failure) {
      await assert.rejects(operation, /fixture failure/);
      assert.equal(stages.at(-1), failure);
    } else {
      await operation;
      assert.deepEqual(stages, ['codesign', 'ditto', 'submit', 'staple', 'validate', 'spctl']);
    }
  }
});
