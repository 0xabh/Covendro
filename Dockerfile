FROM node:24-bookworm-slim AS source
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY . .
RUN npm ci

FROM source AS api
ENV NODE_ENV=production
RUN DATABASE_URL=postgresql://schema:unused@127.0.0.1:5432/covendro npm run db:generate:postgresql && npm run build:api
USER node
EXPOSE 4000
CMD ["npm", "run", "start", "--workspace", "@covendro/api"]

FROM source AS web
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_COVENDRO_PILOT=true
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
ENV NODE_ENV=production
RUN npm run build:web
USER node
EXPOSE 3000
CMD ["npm", "run", "start", "--workspace", "@covendro/web"]
