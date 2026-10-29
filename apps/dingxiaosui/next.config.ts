import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["node:sqlite"],
  webpack(config, { webpack }) {
    config.plugins.push(new webpack.NormalModuleReplacementPlugin(/^cloudflare:workers$/, (resource: {request:string}) => { resource.request = require.resolve("./runtime/node-env.mjs"); }));
    config.plugins.push(new webpack.DefinePlugin({ __ZDX_LOCAL_AUTH__: "false" }));
    return config;
  },
};

export default nextConfig;
