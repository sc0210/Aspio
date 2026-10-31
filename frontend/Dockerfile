# syntax=docker/dockerfile:1
#
# Build stage — runs on the BUILD machine's own architecture, not the target's.
# CI builds the Pi's arm64 image on an x64 runner; under QEMU `next build` took
# ~16 minutes, natively it takes ~3. Its output (.next/standalone + static) is
# JavaScript and does not depend on the CPU it was compiled on, with one exception
# handled in the `sharp` stage below. When build and target match (a build on the Pi
# itself, or a laptop), this is an ordinary single-arch build.
FROM --platform=$BUILDPLATFORM node:22-alpine AS builder
WORKDIR /app

COPY package*.json ./
# Local packages the lockfile links to (see vendor/braces/ASPIRO_PATCH.md).
COPY vendor ./vendor
RUN npm ci

COPY . .

# Optional browser-facing API URL. Next.js inlines NEXT_PUBLIC_* into the client
# bundle during `next build`, so setting it pins the image to that one domain.
# Leave it EMPTY (the default) for a domain-agnostic image: the browser then calls
# the same-origin path /api/v1, which Caddy routes to the backend wherever the app
# is deployed. Set it only for split deployments where the API is on another
# origin. Server-side calls use INTERNAL_API_URL at runtime either way.
# Resolution lives in src/lib/api-url.ts.
ARG NEXT_PUBLIC_API_URL=""
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}

# Optional Cloudflare Web Analytics token (docs/SELF_HOSTING.md, "Analytics").
# Empty (the default) = no analytics and no consent banner. Inlined at build time
# like the URL above, so changing it means rebuilding the image.
ARG NEXT_PUBLIC_CF_ANALYTICS_TOKEN=""
ENV NEXT_PUBLIC_CF_ANALYTICS_TOKEN=${NEXT_PUBLIC_CF_ANALYTICS_TOKEN}

RUN npm run build

# sharp (next/image optimisation) is the one runtime dependency with a native binary,
# shipped as a per-platform @img/* package. The builder installed the BUILD platform's,
# so fetch the TARGET platform's here — this stage runs as the target (under QEMU in
# CI), but it is only an npm download, not a compile. Pinned to the lockfile's version
# so it matches the sharp JavaScript the standalone output traced.
FROM node:22-alpine AS sharp
WORKDIR /sharp
COPY package-lock.json ./
RUN npm install --no-save --no-package-lock --no-audit --no-fund \
      "sharp@$(node -p "require('./package-lock.json').packages['node_modules/sharp'].version")"

# Production stage
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV production
ENV PORT 3000
ENV HOSTNAME 0.0.0.0

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs && chown nextjs:nodejs /app

COPY --chown=nextjs:nodejs --from=builder /app/public ./public
COPY --chown=nextjs:nodejs --from=builder /app/.next/standalone ./
COPY --chown=nextjs:nodejs --from=builder /app/.next/static ./.next/static
# Adds the target's @img/sharp-* binaries beside whatever the builder traced; sharp
# loads the one matching the CPU it runs on.
COPY --chown=nextjs:nodejs --from=sharp /sharp/node_modules/@img ./node_modules/@img

USER nextjs

ARG GIT_SHA=unknown
LABEL org.opencontainers.image.revision=${GIT_SHA}

EXPOSE 3000

CMD ["node", "server.js"]
