import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The static curriculum bundle (spec R5.1): served by the CDN with zero
  // function invocations. `?v=<hash>` on the fetch is what actually busts the
  // cache on a redeploy; this header just lets a CDN edge and the browser
  // hold onto a given hash for a while, with a week of stale-while-revalidate
  // slack behind it.
  async headers() {
    return [
      {
        source: "/curriculum/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=300, stale-while-revalidate=604800" }],
      },
    ];
  },
};

export default nextConfig;
