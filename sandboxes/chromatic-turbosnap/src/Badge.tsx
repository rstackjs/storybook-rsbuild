// Adapted from chromatic-cli e2e fixtures (MIT), commit f744971ec44e03fd4fef4d2e2fcadf2fefb04627:
//   e2e/fixtures/react-rsbuild and e2e/fixtures/monorepo-pnpm
export function Badge({ text }: { text: string }) {
  return <span style={{ padding: '2px 8px' }}>{text}</span>
}
