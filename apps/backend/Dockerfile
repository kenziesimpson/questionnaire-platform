# syntax=docker/dockerfile:1

FROM node:24-slim AS base
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json tsconfig.base.json tsconfig.node.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY apps/backend/package.json apps/backend/package.json
RUN npm ci

FROM deps AS build
COPY packages/shared packages/shared
COPY apps/backend apps/backend
RUN npm run build -w packages/shared && npm run build -w apps/backend

FROM base AS runtime
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY apps/backend/package.json apps/backend/package.json
RUN npm ci --omit=dev --workspace=apps/backend --workspace=packages/shared --include-workspace-root

COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/apps/backend/dist apps/backend/dist
COPY apps/backend/drizzle apps/backend/drizzle

EXPOSE 3000
CMD ["node", "apps/backend/dist/index.js"]
