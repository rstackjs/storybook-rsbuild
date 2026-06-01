import type { Meta, StoryObj } from 'storybook-next-rsbuild'
import styles from './Scss.module.scss'

// Regression target: SCSS modules must compile (variables + nesting) via
// @rsbuild/plugin-sass and produce a hashed, scoped class name.
function ScssProbe() {
  return <div className={styles.box} data-testid="scss-probe" />
}

const meta = { component: ScssProbe } satisfies Meta<typeof ScssProbe>

export default meta

export const Default: StoryObj<typeof meta> = {}
