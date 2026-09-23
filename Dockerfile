FROM node:22-bookworm-slim

WORKDIR /app
COPY package.json package-lock.json ./
COPY packages ./packages
COPY tsconfig.base.json tsconfig.json ./
RUN npm ci && npm run typecheck
COPY examples ./examples
CMD ["node", "packages/mcp/dist/hostCli.js"]
