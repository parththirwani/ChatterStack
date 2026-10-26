import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  compiler: {
    removeConsole: process.env.NODE_ENV === "production",
  },

  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**.googleusercontent.com",
      },
      {
        protocol: "https",
        hostname: "avatars.githubusercontent.com",
      },
    ],
  },

  output: "standalone",
};

export default nextConfig;
