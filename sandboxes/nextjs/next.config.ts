import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  experimental: {
    optimizePackageImports: ['lucide-react'],
  },
  transpilePackages: ['@sandboxes/nextjs-transpiled'],
}

export default nextConfig
