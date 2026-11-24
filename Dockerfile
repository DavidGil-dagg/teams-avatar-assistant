# syntax=docker/dockerfile:1
# Imagen de producción (Next.js standalone). Aún no se despliega; ver README.
#
# La marca se elige al compilar: `docker build --build-arg ASSISTANT_BRAND=<id> .`
# Solo los archivos de esa marca entran en la imagen (ver `next.config.ts`).

FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable

FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

FROM base AS build
WORKDIR /app
ARG ASSISTANT_BRAND=default
ENV ASSISTANT_BRAND=$ASSISTANT_BRAND
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

FROM node:22-alpine AS runner
WORKDIR /app
ARG ASSISTANT_BRAND=default
ENV ASSISTANT_BRAND=$ASSISTANT_BRAND
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
RUN addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/.next/static ./.next/static
USER app
EXPOSE 3000
CMD ["node", "server.js"]
