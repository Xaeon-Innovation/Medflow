import type { NextConfig } from "next";

const apiBaseUrl = process.env.NEXT_PUBLIC_API_URL ?? "";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "res.cloudinary.com",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "lh3.googleusercontent.com",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "*.reactivateai.com",
        pathname: "/**",
      },
    ],
  },
  async rewrites() {
    if (!apiBaseUrl) return [];
    const base = apiBaseUrl.replace(/\/$/, "");
    return [
      {
        source: "/api/backend/:path*",
        destination: `${base}/:path*`,
      },
    ];
  },
};

export default nextConfig;
