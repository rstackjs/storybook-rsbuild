import type { PropsWithChildren } from 'react'
import React, { useMemo } from 'react'
import { HeadManagerContext, initHeadManager } from '../next-internals'

type HeadManagerValue = {
  updateHead?: ((state: JSX.Element[]) => void) | undefined
  mountedInstances?: Set<unknown>
  updateScripts?: ((state: any) => void) | undefined
  scripts?: any
  getIsSsr?: () => boolean
  appDir?: boolean | undefined
  nonce?: string | undefined
}

const HeadManagerProvider: React.FC<PropsWithChildren> = ({ children }) => {
  const headManager: HeadManagerValue = useMemo(() => {
    const hm = initHeadManager()
    hm.getIsSsr = () => false
    return hm
  }, [])

  return (
    <HeadManagerContext.Provider value={headManager}>
      {children}
    </HeadManagerContext.Provider>
  )
}

export default HeadManagerProvider
