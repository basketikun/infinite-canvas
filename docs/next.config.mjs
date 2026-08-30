import { createMDX } from 'fumadocs-mdx/next';

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
  output: 'standalone',
  reactStrictMode: true,
  async rewrites() {
    return [
      { source: '/', destination: '/en' },
      { source: '/docs/:path*', destination: '/en/docs/:path*' },
    ];
  },
};

export default withMDX(config);
