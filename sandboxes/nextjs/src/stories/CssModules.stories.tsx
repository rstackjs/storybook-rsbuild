import type { Meta, StoryObj } from 'storybook-next-rsbuild'
import styles from './CssModules.module.css'

// Regression target: `.module.css` rule is preserved after
// `prepareNextCssRules` filters the oneOf tree. CSS Modules must produce a
// hashed class name (not the literal "card"), proving the css-loader's
// `modules` mode is wired correctly.
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
