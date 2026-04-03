# ============================
# ALPHACORE: Next.js → YC Serverless Container
# Паттерн из kinderly-events
# ============================

# ── STAGE 1: deps ──
FROM node:20-alpine AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ── STAGE 2: builder ──
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Public env vars (inlined at build time)
# None needed for now — no NEXT_PUBLIC_* yet

RUN npm run build

# ── STAGE 3: runner ──
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
# PORT is set by YC Serverless Container at runtime (default 8080)

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# standalone output
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000

CMD ["node", "server.js"]
