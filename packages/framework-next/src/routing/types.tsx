// Adapted from @storybook/nextjs-vite/src/routing/types.tsx
// Diverged: dropped `NextAppDirectory` — App and Pages providers are mounted
// unconditionally, so there is no per-story toggle to type.
export type RouteParams = {
  pathname: string
  query: Record<string, string>
  [key: string]: any
}
