import pkg from './package.json' with { type: 'json' };
import mapWorkspaces from '@npmcli/map-workspaces';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// Code signing is opt-in: it switches on only when the matching secrets exist in the environment
// (GitHub Actions secrets in CI, exported variables locally). Without them the build still succeeds
// and produces unsigned installers. See "Code signing and releases" in BUILD.md.
dropEmptySigningVars(process.env);
const signing = resolveSigning(process.env);
logSigningStatus(signing);

export default /** @type import('electron-builder').Configuration */
({
  appId: 'com.renandiazreyes.jammanmanager',
  productName: 'JamMan Manager',
  directories: {
    output: 'dist',
    buildResources: 'buildResources',
  },
  // Release workflow (.github/workflows/release.yml) runs electron-builder with `--publish always`,
  // which uploads installers and `latest*.yml` to a draft GitHub release for this repository.
  publish: {
    provider: 'github',
    owner: 'RenanDiaz',
    repo: 'jamman-manager',
    releaseType: 'draft',
  },
  generateUpdatesFilesForAllChannels: true,
  /**
   * It is recommended to avoid using non-standard characters such as spaces in artifact names,
   * as they can unpredictably change during deployment, making them impossible to locate and download for update.
   */
  artifactName: '${productName}-${version}-${os}-${arch}.${ext}',
  files: [
    'LICENSE*',
    pkg.main,
    '!node_modules/@app/**',
    ...(await getListOfFilesFromEachWorkspace()),
  ],
  mac: {
    target: [
      {
        target: 'dmg',
        arch: ['x64', 'arm64'],
      },
      {
        target: 'zip',
        arch: ['x64', 'arm64'],
      },
    ],
    category: 'public.app-category.music',
    icon: 'buildResources/icon.icns',
    hardenedRuntime: true,
    gatekeeperAssess: false,
    // One plist for the app and for its helper processes (GPU, renderer, ...). The app is not sandboxed,
    // so the helpers need nothing more than the app itself (no `com.apple.security.inherit`).
    entitlements: 'buildResources/entitlements.mac.plist',
    entitlementsInherit: 'buildResources/entitlements.mac.plist',
    // The Developer ID identity comes from CSC_LINK / CSC_KEY_PASSWORD (or the local keychain);
    // with none, electron-builder skips signing. Notarization is on only when credentials exist,
    // otherwise it is skipped explicitly (and logged) instead of failing the build.
    notarize: signing.mac.notarize,
  },
  dmg: {
    contents: [
      {
        x: 130,
        y: 220,
      },
      {
        x: 410,
        y: 220,
        type: 'link',
        path: '/Applications',
      },
    ],
    title: '${productName} ${version} ${arch}',
    window: {
      width: 540,
      height: 380,
    },
  },
  win: {
    target: [
      {
        target: 'nsis',
        arch: ['x64'],
      },
      {
        target: 'portable',
        arch: ['x64'],
      },
    ],
    icon: 'buildResources/icon.png',
    // Azure Trusted Signing when its settings are complete; otherwise electron-builder signs with
    // the .pfx in WIN_CSC_LINK / CSC_LINK if present, and leaves the installers unsigned if not.
    ...(signing.win.azureSignOptions ? { azureSignOptions: signing.win.azureSignOptions } : {}),
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: '${productName}',
    deleteAppDataOnUninstall: false,
  },
  linux: {
    target: [
      {
        target: 'AppImage',
        arch: ['x64'],
      },
      {
        target: 'deb',
        arch: ['x64'],
      },
      {
        target: 'rpm',
        arch: ['x64'],
      },
    ],
    icon: 'buildResources/icon.png',
    category: 'Audio',
    description: 'JamMan patch editor and loop manager for Digitech JamMan Stereo',
  },
});

/**
 * GitHub Actions turns a secret that does not exist into an empty string, not into an unset variable.
 * electron-builder treats an empty CSC_LINK as "import this (empty) certificate" and fails on macOS,
 * so empty signing variables are removed to make them behave as if they were never set.
 *
 * @param {NodeJS.ProcessEnv} env
 */
function dropEmptySigningVars(env) {
  for (const name of Object.keys(env)) {
    if (/^(CSC_|WIN_CSC_|APPLE_|AZURE_)/.test(name) && (env[name] ?? '').trim() === '') {
      delete env[name];
    }
  }
}

/**
 * Reads the signing-related environment variables and decides what to enable.
 * Never reads or prints secret values: it only checks whether they are set.
 *
 * @param {NodeJS.ProcessEnv} env
 */
function resolveSigning(env) {
  const has = name => (env[name] ?? '').trim() !== '';
  const hasAll = (...names) => names.every(has);
  const hasAny = (...names) => names.some(has);

  // macOS notarization, in the order electron-builder itself checks them.
  const appleApiKey = ['APPLE_API_KEY', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER'];
  const appleId = ['APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID'];
  /** @type {string | null} */
  let notarizeMethod = null;
  if (hasAll(...appleApiKey)) notarizeMethod = 'App Store Connect API key';
  else if (hasAll(...appleId)) notarizeMethod = 'Apple ID + app-specific password';
  else if (has('APPLE_KEYCHAIN_PROFILE')) notarizeMethod = 'keychain profile';
  // A half-set group makes electron-builder throw an obscure error mid-build; say what is missing.
  const partialApple = [appleApiKey, appleId].filter(
    group => hasAny(...group) && !hasAll(...group),
  );

  // Windows: Azure Trusted Signing needs the Entra ID credentials (read by the Azure SDK from the
  // environment) plus the four non-secret settings below.
  const azureCredentials = ['AZURE_TENANT_ID', 'AZURE_CLIENT_ID', 'AZURE_CLIENT_SECRET'];
  const azureSettings = [
    'AZURE_SIGNING_ENDPOINT',
    'AZURE_SIGNING_ACCOUNT',
    'AZURE_SIGNING_PROFILE',
    'AZURE_SIGNING_PUBLISHER_NAME',
  ];
  const azureAll = [...azureCredentials, ...azureSettings];
  const azureComplete = hasAll(...azureAll);

  return {
    mac: {
      notarize: notarizeMethod !== null,
      notarizeMethod,
      partialApple,
    },
    win: {
      azureSignOptions: azureComplete
        ? {
            publisherName: env.AZURE_SIGNING_PUBLISHER_NAME,
            endpoint: env.AZURE_SIGNING_ENDPOINT,
            codeSigningAccountName: env.AZURE_SIGNING_ACCOUNT,
            certificateProfileName: env.AZURE_SIGNING_PROFILE,
          }
        : null,
      azureMissing: hasAny(...azureAll) && !azureComplete ? azureAll.filter(n => !has(n)) : [],
      hasPfx: hasAny('WIN_CSC_LINK', 'CSC_LINK'),
    },
  };
}

/**
 * Logs one line per platform so it is obvious in the build log what will be signed.
 * Only variable names are printed, never values.
 *
 * @param {ReturnType<typeof resolveSigning>} s
 */
function logSigningStatus(s) {
  const log = message => console.log(`[signing] ${message}`);
  const warn = message => console.warn(`[signing] WARNING: ${message}`);

  if (s.mac.notarize) {
    log(`macOS notarization enabled (${s.mac.notarizeMethod}).`);
  } else {
    warn(
      'macOS notarization is OFF (no APPLE_API_KEY/APPLE_API_KEY_ID/APPLE_API_ISSUER set). ' +
        'A macOS build will not pass Gatekeeper and auto-update will not work.',
    );
  }
  for (const group of s.mac.partialApple) {
    warn(`incomplete Apple credentials: set all of ${group.join(', ')} or none.`);
  }
  if (s.win.azureSignOptions) {
    log('Windows signing: Azure Trusted Signing.');
  } else if (s.win.azureMissing.length > 0) {
    warn(`incomplete Azure Trusted Signing settings, missing: ${s.win.azureMissing.join(', ')}.`);
  }
  if (!s.win.azureSignOptions && s.win.hasPfx) {
    log('Windows signing: .pfx certificate (WIN_CSC_LINK / CSC_LINK).');
  } else if (!s.win.azureSignOptions) {
    warn(
      'Windows signing is not configured: the installers will be UNSIGNED (SmartScreen warning).',
    );
  }
}

/**
 * By default, electron-builder copies each package into the output compilation entirety,
 * including the source code, tests, configuration, assets, and any other files.
 *
 * So you may get compiled app structure like this:
 * ```
 * app/
 * ├── node_modules/
 * │   └── workspace-packages/
 * │       ├── package-a/
 * │       │   ├── src/            # Garbage. May be safely removed
 * │       │   ├── dist/
 * │       │   │   └── index.js    # Runtime code
 * │       │   ├── vite.config.js  # Garbage
 * │       │   ├── .env            # some sensitive config
 * │       │   └── package.json
 * │       ├── package-b/
 * │       ├── package-c/
 * │       └── package-d/
 * ├── packages/
 * │   └── entry-point.js
 * └── package.json
 * ```
 *
 * To prevent this, we read the “files”
 * property from each package's package.json
 * and add all files that do not match the patterns to the exclusion list.
 *
 * This way,
 * each package independently determines which files will be included in the final compilation and which will not.
 *
 * So if `package-a` in its `package.json` describes
 * ```json
 * {
 *   "name": "package-a",
 *   "files": [
 *     "dist/**\/"
 *   ]
 * }
 * ```
 *
 * Then in the compilation only those files and `package.json` will be included:
 * ```
 * app/
 * ├── node_modules/
 * │   └── workspace-packages/
 * │       ├── package-a/
 * │       │   ├── dist/
 * │       │   │   └── index.js    # Runtime code
 * │       │   └── package.json
 * │       ├── package-b/
 * │       ├── package-c/
 * │       └── package-d/
 * ├── packages/
 * │   └── entry-point.js
 * └── package.json
 * ```
 */
async function getListOfFilesFromEachWorkspace() {
  /**
   * @type {Map<string, string>}
   */
  const workspaces = await mapWorkspaces({
    cwd: process.cwd(),
    pkg,
  });

  const allFilesToInclude = [];

  for (const [name, path] of workspaces) {
    const pkgPath = join(path, 'package.json');
    const { default: workspacePkg } = await import(pathToFileURL(pkgPath), {
      with: { type: 'json' },
    });

    let patterns = workspacePkg.files || ['dist/**', 'package.json'];

    patterns = patterns.map(p => join('node_modules', name, p));
    allFilesToInclude.push(...patterns);
  }

  return allFilesToInclude;
}
