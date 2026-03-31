import type { NextConfig } from "next";
import { withBetterStack } from "@logtail/next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "lh3.googleusercontent.com",
      },
    ],
  },
};

export default withBetterStack(nextConfig);
