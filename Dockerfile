# LAMS — Land Acquisition and Management Software Solution
#
# Builds the React front end, then serves it and the API from one Node process.
# No configuration is baked into the image: every setting is supplied at run time
# through the environment, so the same image runs in every environment.

# ---- Stage 1: install and build ---------------------------------------------
FROM node:22-alpine AS build

WORKDIR /app

# Copy manifests first so the dependency layer is cached independently of source.
COPY package.json package-lock.json ./
COPY client/package.json ./client/
COPY server/package.json ./server/
COPY migrations/package.json ./migrations/

RUN npm ci

COPY . .

# The browser bundle needs its VITE_* values at build time. They are supplied as
# build arguments, not baked into the Dockerfile, and never include a secret.
ARG VITE_APP_NAME
ARG VITE_API_BASE_URL
ARG VITE_ORG_NAME
ARG VITE_AUTH_PROVIDER
ARG VITE_MAP_PROVIDER
ARG VITE_MAP_BASEMAP_URL
ARG VITE_MAP_BASEMAP_ATTRIBUTION
ARG VITE_MAP_DEFAULT_CENTER
ARG VITE_MAP_DEFAULT_ZOOM
ARG VITE_MAP_MAX_ZOOM
ARG VITE_MAP_LAYERS
ARG VITE_MAP_API_KEY
ARG VITE_MAP_FEATURE_SERVICE_URL
ARG VITE_FEATURE_MAP
ARG VITE_FEATURE_DOCUMENT_GENERATION
ARG VITE_FEATURE_TIMBER
ARG CLIENT_URL

RUN npm run build --workspace client


# ---- Stage 2: runtime --------------------------------------------------------
FROM node:22-alpine AS runtime

ENV NODE_ENV=production
WORKDIR /app

# Production dependencies only.
COPY package.json package-lock.json ./
COPY client/package.json ./client/
COPY server/package.json ./server/
COPY migrations/package.json ./migrations/
RUN npm ci --omit=dev && npm cache clean --force

COPY server ./server
COPY migrations ./migrations
COPY scripts ./scripts
COPY --from=build /app/client/dist ./client/dist

# Writable locations for generated documents and scheduled report files.
RUN mkdir -p /app/uploads /app/reports /app/integration \
    && chown -R node:node /app/uploads /app/reports /app/integration

USER node

EXPOSE 4000

# Fails the container if the API stops answering.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/src/server.js"]
