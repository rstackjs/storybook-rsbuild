// Port: @storybook/nextjs-vite/src/export-mocks/cache/index.ts
import { fn } from 'storybook/test'

type Callback = (...args: any[]) => Promise<any>

const revalidatePath = fn().mockName('next/cache::revalidatePath')
const revalidateTag = fn().mockName('next/cache::revalidateTag')
const unstable_cache = fn()
  .mockName('next/cache::unstable_cache')
  .mockImplementation((cb: Callback) => cb)
const unstable_noStore = fn().mockName('next/cache::unstable_noStore')

const cacheExports = {
  unstable_cache,
  revalidateTag,
  revalidatePath,
  unstable_noStore,
}

export default cacheExports
export { revalidatePath, revalidateTag, unstable_cache, unstable_noStore }
