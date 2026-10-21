import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  devIndicators: false,
  images: { formats: ['image/avif', 'image/webp'] },
  typedRoutes: true,
  transpilePackages: [
    '@nestself/ui',
    '@nestself/tokens',
    '@nestself/i18n',
    '@nestself/contracts',
    '@nestself/assets',
    '@nestself/sample-data',
    '@nestself/api-client',
  ],
  webpack(config) {
    config.resolve ??= {};
    config.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js', '.jsx'],
      '.mjs': ['.mts', '.mjs'],
    };
    return config;
  },
  async redirects() {
    return [
      {
        source: '/:locale(en|sr-Latn|sr-Cyrl|hu)/support',
        destination: '/:locale/services',
        permanent: true,
      },
      {
        source: '/:locale(en|sr-Latn|sr-Cyrl|hu)/employers',
        destination: '/:locale/for-employers',
        permanent: true,
      },
    ];
  },
};
export default config;
