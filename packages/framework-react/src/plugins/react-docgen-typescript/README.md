# The code in this directory is copied and modified from [@joshwooding/vite-plugin-react-docgen-typescript](https://github.com/joshwooding/vite-plugin-react-docgen-typescript/tree/bf0ea3a603fb388bc28104c65aea49beb236aa6c) under MIT license.

`utils/runtime-target.ts` is ported from the same project at tag `@joshwooding/vite-plugin-react-docgen-typescript@0.9.0` (commit `6f7e7cf2f8c61ad3e83bcbd3aec4f85029798089`, MIT) to resolve the assignment target for default exports, static sub-components and custom display names (#622). Local target-resolution fixes cover namespaced members, destructured exports, shorthand properties and Unicode identifiers.

# @joshwooding/vite-plugin-react-docgen-typescript

[![npm](https://img.shields.io/npm/v/@joshwooding/vite-plugin-react-docgen-typescript.svg)](https://www.npmjs.com/package/@joshwooding/vite-plugin-react-docgen-typescript)
[![Code style: Prettier](https://img.shields.io/badge/code_style-prettier-ff69b4.svg)](https://github.com/prettier/prettier)

> A vite plugin to inject react typescript docgen information

&nbsp;

### Usage

```ts
import reactDocgenTypescript from '@joshwooding/vite-plugin-react-docgen-typescript'

export default {
  plugins: [reactDocgenTypescript()],
}
```
