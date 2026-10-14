import test from 'node:test';
import assert from 'node:assert/strict';
import { macSigning, prepareMacSigning, notarizeMacApp } from '../../tools/package-mac';
import type { runProcess } from '../../tools/run-process';

const identity = 'Developer ID Application: Example Studio (ABCDEFGHIJ)';
const signed = { platform: 'mac' as const, signed: true, identity, 'notary-profile': 'example' };

test('release signing rejects development identities and unsupported modes before packaging', () => {
  assert.deepEqual(macSigning({ platform: 'mac' }, 'darwin'), {
    identity: undefined,
    keychainProfile: 'lantern-knight-notary',
  });
  for (const options of [
    { platform: 'win' as const },
    { platform: 'mac' as const, dev: true },
    { platform: 'mac' as const, local: true },
    { platform: 'mac' as const, unsigned: true },
  ])
    assert.equal(macSigning(options, 'darwin'), undefined);
  assert.deepEqual(macSigning(signed, 'darwin'), { identity, keychainProfile: 'example' });
  for (const options of [
    { ...signed, platform: 'win' as const },
    { ...signed, dev: true },
    { ...signed, local: true },
    { ...signed, identity: 'Apple Development: Example Studio (ABCDEFGHIJ)' },
    { ...signed, identity: '-' },
    { ...signed, 'notary-profile': '' },
    { ...signed, unsigned: true },
    { ...signed, signed: false, unsigned: true },
  ])
    assert.throws(() => macSigning(options, 'darwin'));
  assert.throws(() => macSigning(signed, 'win32'));
});

test('automatic signing selects only a unique valid release certificate and checks saved credentials', async () => {
  const line = (name: string) => `  1) ${'A'.repeat(40)} "${name}"\n`;
  const development = line('Apple Development: Example Studio (ABCDEFGHIJ)');
  const second = 'Developer ID Application: Another Studio (1234567890)';
  const automatic = macSigning({ platform: 'mac' }, 'darwin')!;
  for (const inventory of ['', development, line(identity) + line(second)]) {
    const commands: string[] = [];
    const run: typeof runProcess = async (command, _args, options) => {
      commands.push(command);
      options.output?.(Buffer.from(inventory));
    };
    await assert.rejects(prepareMacSigning(automatic, '/example', run), /exactly one/);
    assert.deepEqual(commands, ['security']);
  }
  const calls: string[][] = [];
  const run: typeof runProcess = async (command, args, options) => {
    calls.push([command, ...args]);
    if (command === 'security') options.output?.(Buffer.from(development + line(identity)));
  };
  assert.deepEqual(await prepareMacSigning(automatic, '/example', run), {
    identity,
    keychainProfile: 'lantern-knight-notary',
  });
  assert.ok(calls[1]!.includes('lantern-knight-notary'));
  const ambiguous: typeof runProcess = async (command, _args, options) => {
    if (command === 'security') options.output?.(Buffer.from(line(identity) + line(second)));
  };
  assert.equal(
    (await prepareMacSigning({ ...automatic, identity: second }, '/example', ambiguous)).identity,
    second,
  );
  await assert.rejects(
    prepareMacSigning({ ...automatic, identity: second }, '/example', run),
    /Install the requested/,
  );
  const invalidCredentials: typeof runProcess = async (command, _args, options) => {
    if (command === 'security') options.output?.(Buffer.from(line(identity)));
    else throw new Error('credential fixture failure');
  };
  await assert.rejects(
    prepareMacSigning(automatic, '/example', invalidCredentials),
    /credential check failed/,
  );
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
