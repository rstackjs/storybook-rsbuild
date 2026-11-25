import { isActive, normalizeHref } from '@rspress/core/dist/runtime/index.js'

export * from '@rspress/core/dist/runtime/index.js'

// Rspress 2.1.3 treats nav links as regular expressions, so /guide/ also
// highlights on /guide/configuration. Use the router's page matching instead.
export const matchNavbar = (
  item: { link: string },
  pathname: string,
): boolean => isActive(normalizeHref(item.link, true), pathname)
