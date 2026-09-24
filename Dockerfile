FROM node:22-bookworm-slim

WORKDIR /app
COPY package.json package-lock.json ./
COPY packages ./packages
COPY tsconfig.base.json tsconfig.json ./
RUN npm ci && npx playwright install --with-deps chromium && npm run typecheck
COPY examples ./examples
COPY research/amazon-product-schema.v1.json ./research/amazon-product-schema.v1.json
COPY scripts/section-c/ensure-amazon-sg-state.mjs ./scripts/section-c/ensure-amazon-sg-state.mjs
CMD ["node", "packages/mcp/dist/hostCli.js"]
