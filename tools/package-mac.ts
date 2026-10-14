import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { runProcess } from './run-process';

export function macSigning(
  options: {
    platform: 'mac' | 'win';
    signed?: boolean;
    dev?: boolean;
    local?: boolean;
    identity?: string;
    'notary-profile'?: string;
  },
  host = process.platform,
) {
  if (!options.signed) {
    if (options.identity !== undefined || options['notary-profile'] !== undefined)
      throw new Error('--identity and --notary-profile require --signed');
    return undefined;
  }
  if (host !== 'darwin' || options.platform !== 'mac' || options.dev || options.local)
    throw new Error('--signed requires a pinned Game package on a macOS host');
  if (!/^Developer ID Application: .+ \([A-Z0-9]{10}\)$/.test(options.identity ?? ''))
    throw new Error('--signed requires --identity with the full Developer ID Application name');
  const keychainProfile = options['notary-profile']?.trim();
  if (!keychainProfile)
    throw new Error('--signed requires --notary-profile with a Keychain profile');
  return { identity: options.identity!, keychainProfile };
}

type Signing = NonNullable<ReturnType<typeof macSigning>>;

export async function prepareMacSigning(signing: Signing, root: string) {
  const identities = execFileSync('security', ['find-identity', '-v', '-p', 'codesigning'], {
    encoding: 'utf8',
    timeout: 15000,
  });
  if (!identities.includes('"' + signing.identity + '"'))
    throw new Error(
      'Install the requested Developer ID Application certificate and private key first',
    );
  let output = '';
  try {
    await runProcess(
      'xcrun',
      [
        'notarytool',
        'history',
        '--keychain-profile',
        signing.keychainProfile,
        '--output-format',
        'json',
      ],
      {
        cwd: root,
        timeoutMs: 120000,
        output: (chunk) => {
          output += chunk.toString();
        },
      },
    );
  } catch (error) {
    throw new Error(
      'Notarization credential check failed. Create or repair the Keychain profile with notarytool store-credentials.\n' +
        output,
      { cause: error },
    );
  }
}

export async function notarizeMacApp(signing: Signing, root: string, run = runProcess) {
  const app = path.join(root, 'release/mac-arm64/Lantern Knight.app');
  const archive = path.join(root, 'release/Lantern Knight-notary.zip');
  const options = { cwd: root, timeoutMs: 10 * 60_000 };
  await run(
    'codesign',
    [
      '--verify',
      '--deep',
      '--strict',
      '--verbose=2',
      '-R=anchor apple generic and certificate leaf[field.1.2.840.113635.100.6.1.13] exists',
      app,
    ],
    options,
  );
  await run('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', app, archive], options);
  let output = '';
  console.log('Submitting signed Game to Apple for notarization; this can take several minutes.');
  try {
    await run(
      'xcrun',
      [
        'notarytool',
        'submit',
        archive,
        '--keychain-profile',
        signing.keychainProfile,
        '--wait',
        '--timeout',
        '30m',
        '--output-format',
        'json',
      ],
      {
        ...options,
        timeoutMs: 35 * 60_000,
        output: (chunk) => {
          output += chunk.toString();
        },
      },
    );
  } catch (error) {
    console.error(output);
    throw error;
  }
  const result = JSON.parse(output) as { id?: string; status?: string };
  console.log(`Apple notarization: ${result.status}; submission ${result.id ?? 'unknown'}.`);
  if (result.status !== 'Accepted')
    throw new Error(
      'Apple did not accept the app. Retrieve the submission log with notarytool log before retrying.',
    );
  await run('xcrun', ['stapler', 'staple', app], options);
  await run('xcrun', ['stapler', 'validate', app], options);
  await run('spctl', ['--assess', '--type', 'execute', '--verbose=2', app], options);
  // The submission archive predates stapling. Steam receives the validated .app.
  console.log(
    'PASS: Developer ID signature, accepted notarization, stapled ticket and Gatekeeper assessment.',
  );
}
