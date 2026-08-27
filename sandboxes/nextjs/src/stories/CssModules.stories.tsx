import type { Meta, StoryObj } from 'storybook-next-rsbuild'
import styles from './CssModules.module.css'

// Regression target: CSS Modules must produce a hashed class name (not the
// literal "card"), proving Rsbuild's css-loader `modules` mode is wired up.
function CssModulesProbe() {
  return (
    <div className={styles.card} data-testid="css-modules-probe">
      <span data-testid="css-modules-classname">{styles.card}</span>
    </div>
  )
}

const meta = { component: CssModulesProbe } satisfies Meta<
  typeof CssModulesProbe
>

export default meta

export const Default: StoryObj<typeof meta> = {}
