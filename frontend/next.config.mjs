import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const repoRoot = path.resolve(__dirname, '..');
const hasParentPackage = fs.existsSync(path.join(repoRoot, 'package.json'));

const tracingRoot = process.env.OUTPUT_FILE_TRACING_ROOT
  ? path.resolve(process.env.OUTPUT_FILE_TRACING_ROOT)
  : (hasParentPackage ? repoRoot : __dirname);

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  output: 'standalone',
  outputFileTracingRoot: tracingRoot,
  webpack: (config) => {
    config.externals.push('pino-pretty', 'lokijs', 'encoding');
    config.resolve.fallback = {
      ...config.resolve.fallback,
      '@x402/evm/upto/client': false,
      '@x402/evm/exact/client': false,
      '@x402/core/client': false,
      '@x402/svm/exact/client': false,
      '@x402/evm': false,
    };
    return config;
  },
};

export default nextConfig;
