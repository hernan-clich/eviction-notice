/** @type {import('next').NextConfig} */
const nextConfig = {
  // `shared` is a workspace TS package shipped as source; let Next compile it.
  transpilePackages: ['shared'],
  // Linting is handled by the repo-wide flat ESLint config (`pnpm lint`), not by
  // `next lint`, so don't re-run it during the build.
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
