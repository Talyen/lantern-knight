import path from 'node:path';
import { runProcess } from './run-process';

export function macSigning(
  options: {
    platform: 'mac' | 'win';
    signed?: boolean;
    unsigned?: boolean;
    dev?: boolean;
    local?: boolean;
    identity?: string;
    'notary-profile'?: string;
  },
  host = process.platform,
) {
  if (options.signed && options.unsigned)
    throw new Error('--signed and --unsigned cannot be combined');
  const release = options.platform === 'mac' && !options.dev && !options.local;
  if (!options.signed && (!release || options.unsigned)) {
    if (options.identity !== undefined || options['notary-profile'] !== undefined)
      throw new Error('--identity and --notary-profile require signed Mac release packaging');
    return undefined;
  }
  if (host !== 'darwin' || !release)
    throw new Error(
      'Signing requires a pinned Game package on a macOS host; use --unsigned for CI',
    );
  if (
    options.identity !== undefined &&
    !/^Developer ID Application: .+ \([A-Z0-9]{10}\)$/.test(options.identity)
  )
    throw new Error('--identity must be the full Developer ID Application name');
  const keychainProfile = (options['notary-profile'] ?? 'lantern-knight-notary').trim();
  if (!keychainProfile) throw new Error('--notary-profile must name a Keychain profile');
  return { identity: options.identity, keychainProfile };
}

type Signing = NonNullable<ReturnType<typeof macSigning>>;

export async function prepareMacSigning(signing: Signing, root: string, run = runProcess) {
  let output = '';
  await run('security', ['find-identity', '-v', '-p', 'codesigning'], {
    cwd: root,
    timeoutMs: 15000,
    output: (chunk) => {
      output += chunk.toString();
    },
  });
  const identities = [
    ...output.matchAll(/^\s*\d+\)\s+[A-Fa-f0-9]{40}\s+"(Developer ID Application: .+)"$/gm),
  ].map((match) => match[1]!);
  if (!signing.identity && identities.length !== 1)
    throw new Error(
      'Expected exactly one valid Developer ID Application certificate and private key. Install one, or select it with --identity; use --unsigned only for development/CI.',
    );
  const identity = signing.identity ?? identities[0]!;
  if (!identities.includes(identity))
    throw new Error(
      'Install the requested Developer ID Application certificate and private key first',
    );
  output = '';
  try {
    await run(
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
  return { identity, keychainProfile: signing.keychainProfile };
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
