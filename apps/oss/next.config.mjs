import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import createMDX from '@next/mdx';
import remarkGfm from 'remark-gfm';

const here = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(here, '../..');

const withMDX = createMDX({
  extension: /\.mdx?$/,
  options: { remarkPlugins: [remarkGfm] },
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  outputFileTracingRoot: workspaceRoot,
  eslint: { ignoreDuringBuilds: true },
  pageExtensions: ['ts', 'tsx', 'mdx'],
  async rewrites() {
    return [
      { source: '/app', destination: '/app/index.html' },
      { source: '/app/', destination: '/app/index.html' },
    ];
  },
};

export default withMDX(nextConfig);
