# storybook-next-rsbuild

> [!WARNING]
> **Experimental.** This package bridges Storybook to Next.js's own build pipeline via `next-rspack`'s `getBaseWebpackConfig()`. Until it reaches a stable release, **any Next.js minor or patch upgrade may break compatibility** — including changes to internal `next/dist/*` paths, the `getBaseWebpackConfig` signature, or DOM anchors expected at runtime. Pin your `next` version if you need reproducibility, and expect to upgrade this package in lockstep with Next.js releases.
>
> `next-rspack` itself is an experimental integration on the Next.js side. See [AGENTS.md](./AGENTS.md) for the shim catalogue and "remove when" conditions for each workaround.

Check out [rstackjs/storybook-rsbuild](https://github.com/rstackjs/storybook-rsbuild) for documentation.

## Installation

Install `storybook-next-rsbuild` alongside `next-rspack` **pinned to your exact `next` version** — a bare `next-rspack` install pulls the registry's latest, which the startup check rejects when it doesn't match your `next` — plus the `@rsbuild/core` from the [version matrix](https://storybook.rsbuild.rs/guide/framework/next#version-matrix). For example, on `next@16.2.3`:

```bash
pnpm add -D storybook-next-rsbuild next-rspack@16.2.3 @rsbuild/core@1.6.14
```

`next-rspack` must be resolvable from Next.js itself because Next internally calls `require('next-rspack/rspack-core')` while generating the bridged Rspack config. Keep the `next-rspack` version aligned with your `next` version.

## 🤖 Agent Skills

Using an AI coding agent? Install the agent skills for guided setup: `npx skills add rstackjs/agent-skills --skill storybook-rsbuild`
