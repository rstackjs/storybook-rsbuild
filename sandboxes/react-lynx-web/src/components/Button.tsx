import { useCallback, useState } from '@lynx-js/react'

import lynxLogo from '../assets/lynx-logo.png'
import reactLogo from '../assets/react-logo.png'

export function Button() {
  const globalProps = lynx.__globalProps as {
    label?: string
    primary?: boolean
  }

  const label = globalProps?.label ?? 'Button'
  const primary = globalProps?.primary ?? false

  const [count, setCount] = useState(0)
  const [alterLogo, setAlterLogo] = useState(false)

  const onLogoTap = useCallback(() => {
    'background-only'
    setAlterLogo((v) => !v)
  }, [])

  const onCountTap = useCallback(() => {
    'background-only'
    setCount((c) => c + 1)
  }, [])

  return (
    <page>
      <view className="Background" />
      <view className="App">
        <view className="Banner">
          <view className="Logo" bindtap={onLogoTap}>
            {alterLogo ? (
              <image src={reactLogo} className="Logo--react" />
            ) : (
              <image src={lynxLogo} className="Logo--lynx" />
            )}
          </view>
          <text className="Title">ReactLynx</text>
          <text className="Subtitle">on Storybook</text>
        </view>

        <view className="Counter">
          <text className="Counter__value">{count}</text>
          <view
            className={`Counter__btn ${primary ? 'Counter__btn--primary' : 'Counter__btn--secondary'}`}
            bindtap={onCountTap}
          >
            <text className="Counter__btn-text">{label}</text>
          </view>
        </view>

        <view className="Content">
          <text className="Hint">
            Tap the logo to switch. Edit the source to test HMR.
          </text>
        </view>
      </view>
    </page>
  )
}
