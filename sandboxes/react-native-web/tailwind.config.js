import nativewindPreset from 'nativewind/preset'

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{js,jsx,ts,tsx}'],
  presets: [nativewindPreset],
  theme: {
    extend: {},
  },
  plugins: [],
}
