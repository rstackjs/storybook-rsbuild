import Image from 'next/image'
import styles from './page.module.css'

export default function Home() {
  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <Image
          className={styles.logo}
          src="/vercel.svg"
          alt="Vercel logomark"
          width={180}
          height={38}
          priority
        />
        <h1 className={styles.title}>storybook-next-rsbuild sandbox</h1>
        <p className={styles.description}>
          A minimal Next.js App Router project used to exercise the Storybook +
          Rsbuild framework integration. Edit stories under{' '}
          <code className={styles.code}>src/stories/</code> and run{' '}
          <code className={styles.code}>pnpm storybook</code> to preview them.
        </p>
        <div className={styles.instructions}>
          Get started by editing{' '}
          <span className={styles.code}>app/page.tsx</span>.<br />
          Save and reload — changes appear instantly.
        </div>
        <div className={styles.ctas}>
          <a
            className={styles.primary}
            href="https://storybook.rsbuild.rs"
            target="_blank"
            rel="noopener noreferrer"
          >
            Storybook Rsbuild docs
          </a>
          <a
            className={styles.secondary}
            href="https://nextjs.org/docs"
            target="_blank"
            rel="noopener noreferrer"
          >
            Next.js docs →
          </a>
        </div>
      </main>
      <footer className={styles.footer}>
        <a
          href="https://github.com/rstackjs/storybook-rsbuild"
          target="_blank"
          rel="noopener noreferrer"
        >
          GitHub
        </a>
        <a
          href="https://github.com/vercel/next.js/tree/canary/packages/next-rspack"
          target="_blank"
          rel="noopener noreferrer"
        >
          next-rspack
        </a>
        <a href="https://rsbuild.rs" target="_blank" rel="noopener noreferrer">
          Rsbuild
        </a>
      </footer>
    </div>
  )
}
