import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { CDVC } from 'check-dependency-version-consistency'
import path from 'pathe'

const __filename = fileURLToPath(import.meta.url)
const root = path.resolve(path.dirname(__filename), '..')

let mismatch = false

// === dependencies ===
const cdvcDep = new CDVC(root, {
  depType: ['dependencies'],
  ignorePackage: ['@sandboxes/react-16'],
})

const dep = cdvcDep.hasMismatchingDependencies
if (dep) {
  mismatch = true
  console.log(cdvcDep.toMismatchSummary())
}

// === devDependencies ===
const cdvcDevDep = new CDVC(root, {
  depType: ['devDependencies'],
  ignorePackage: ['@sandboxes/react-16', 'website'],
})

const dev = cdvcDevDep.hasMismatchingDependencies
if (dev) {
  mismatch = true
  console.log(cdvcDevDep.toMismatchSummary())
}

// === peerDependencies ===
const cdvcPeerDev = new CDVC(root, {
  depType: ['peerDependencies'],
  ignorePackage: ['storybook-builder-rsbuild'],
})

// === optionalDependencies & resolutions ===
const cdvcOptRes = new CDVC(root, {
  depType: ['optionalDependencies', 'resolutions'],
})

const optRes = cdvcOptRes.hasMismatchingDependencies
if (optRes) {
  mismatch = true
  console.log(cdvcOptRes.toMismatchSummary())
}

const peer = cdvcPeerDev.hasMismatchingDependencies
if (peer) {
  mismatch = true
  console.log(cdvcPeerDev.toMismatchSummary())
}

// === framework peer `storybook` must match bundled @storybook/<renderer>'s own peer ===
// Rationale: under pnpm, if a framework package declares a broader `storybook` peer range
// than the nested `@storybook/<renderer>` it depends on, consumers can end up with two
// copies of `storybook` in the virtual store (the "doppelganger"). Keep them aligned.
// See: https://pnpm.io/how-peers-are-resolved
const packagesDir = path.join(root, 'packages')
for (const entry of fs.readdirSync(packagesDir)) {
  const pkgPath = path.join(packagesDir, entry, 'package.json')
  if (!fs.existsSync(pkgPath)) continue
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
  const ownPeer = pkg.peerDependencies?.storybook
  if (!ownPeer) continue
  const rendererDep = Object.keys(pkg.dependencies ?? {}).find(
    (d) =>
      d.startsWith('@storybook/') &&
      d !== '@storybook/react-docgen-typescript-plugin',
  )
  if (!rendererDep) continue
  const rendererPkgPath = path.join(
    packagesDir,
    entry,
    'node_modules',
    ...rendererDep.split('/'),
    'package.json',
  )
  if (!fs.existsSync(rendererPkgPath)) {
    mismatch = true
    console.error(
      `[${pkg.name}] cannot locate installed ${rendererDep} — run \`pnpm install\` before this check`,
    )
    continue
  }
  const rendererPkg = JSON.parse(fs.readFileSync(rendererPkgPath, 'utf8'))
  const rendererPeer = rendererPkg.peerDependencies?.storybook
  if (rendererPeer && ownPeer !== rendererPeer) {
    mismatch = true
    console.error(
      `[${pkg.name}] peerDependencies.storybook "${ownPeer}" ` +
        `must equal ${rendererDep}@${rendererPkg.version} peer "${rendererPeer}" ` +
        `to avoid pnpm doppelganger`,
    )
  }
}

if (mismatch) {
  console.error('Dependency version mismatches found.')
  process.exit(1)
} else {
  console.log('No dependency version mismatches found.')
}
