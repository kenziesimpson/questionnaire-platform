# syntax=docker/dockerfile:1

FROM node:24-slim AS deps
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY packages/ui/package.json packages/ui/package.json
COPY apps/respondent/package.json apps/respondent/package.json
COPY apps/admin/package.json apps/admin/package.json
RUN npm ci

FROM deps AS build
COPY packages/shared packages/shared
COPY packages/ui packages/ui
COPY apps/respondent apps/respondent
COPY apps/admin apps/admin
RUN npm run build -w packages/shared && npm run build -w apps/respondent && npm run build -w apps/admin

FROM nginx:1.27-alpine AS runtime
COPY deploy/frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/respondent/dist /usr/share/nginx/html
COPY --from=build /app/apps/admin/dist /usr/share/nginx/html/admin
EXPOSE 80
