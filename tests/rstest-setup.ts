// Code taken from https://github.com/storybookjs/storybook/blob/next/code/vitest-setup.ts.
import { resolve } from 'node:path'
import { expect } from '@rstest/core'
import * as jestDomMatchers from '@testing-library/jest-dom/matchers'
import { createSnapshotSerializer } from 'path-serializer'

const workspaceRoot = resolve(__dirname)

expect.addSnapshotSerializer(
  createSnapshotSerializer({
    root: workspaceRoot,
    workspace: workspaceRoot,
  }),
)

expect.extend(jestDomMatchers)
