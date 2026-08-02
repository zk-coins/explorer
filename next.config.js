/**
 * Next.js config for the zkCoins explorer.
 *
 * Static export only: no server runtime, no server state, no keys.
 * The node/API base URL is required at build time — there is no default host.
 */

const baseUrl = process.env.NEXT_PUBLIC_NODE_BASE_URL;
if (typeof baseUrl !== 'string' || baseUrl.length === 0) {
  throw new Error(
    'NEXT_PUBLIC_NODE_BASE_URL is required at build time (no default). ' +
      'Set it to the node/API origin the explorer should read, e.g. https://node.example.com',
  );
}
if (!/^https?:\/\//.test(baseUrl)) {
  throw new Error(
    `NEXT_PUBLIC_NODE_BASE_URL must start with http:// or https://, got ${JSON.stringify(baseUrl)}`,
  );
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Stateless, self-hostable container: pure static assets + client hydration.
  // Static export does not support next.config headers(); Referrer-Policy is
  // set via <meta name="referrer" content="no-referrer"> in the root layout
  // (spec §5.6 defense-in-depth for bearer fragment secrets).
  output: 'export',
  images: {
    unoptimized: true,
  },
  trailingSlash: true,
};

module.exports = nextConfig;
