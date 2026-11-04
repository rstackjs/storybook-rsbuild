// Code taken from https://github.com/storybookjs/storybook/blob/next/code/vitest-setup.ts.
import * as jestDomMatchers from '@testing-library/jest-dom/matchers'
import { resolve } from 'node:path'
import { createSnapshotSerializer } from 'path-serializer'
import { expect } from 'rstack/test'

const workspaceRoot = resolve(__dirname)

expect.addSnapshotSerializer(
  createSnapshotSerializer({
    root: workspaceRoot,
    workspace: workspaceRoot,
  }),
)

expect.extend(jestDomMatchers)
