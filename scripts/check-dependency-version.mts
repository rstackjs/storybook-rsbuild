import { fileURLToPath } from 'node:url'
import { CDVC } from 'check-dependency-version-consistency'
import path from 'pathe'

const __filename = fileURLToPath(import.meta.url)
const root = path.resolve(path.dirname(__filename), '..')

let mismatch = false

// === dependencies ===
const cdvcDep = new CDVC(root, {
  depType: ['dependencies'],
  ignorePackage: ['@sandboxes/react-16', '@sandboxes/nextjs'],
})

const dep = cdvcDep.hasMismatchingDependencies
if (dep) {
  mismatch = true
  console.log(cdvcDep.toMismatchSummary())
}

// === devDependencies ===
const cdvcDevDep = new CDVC(root, {
  depType: ['devDependencies'],
  ignorePackage: [
    '@sandboxes/react-16',
    '@sandboxes/nextjs',
    'storybook-next-rsbuild',
    'website',
  ],
})

const dev = cdvcDevDep.hasMismatchingDependencies
if (dev) {
  mismatch = true
  console.log(cdvcDevDep.toMismatchSummary())
}

// === peerDependencies ===
const cdvcPeerDev = new CDVC(root, {
  depType: ['peerDependencies'],
  ignorePackage: ['storybook-builder-rsbuild', 'storybook-next-rsbuild'],
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

if (mismatch) {
  console.error('Dependency version mismatches found.')
  process.exit(1)
} else {
  console.log('No dependency version mismatches found.')
}
