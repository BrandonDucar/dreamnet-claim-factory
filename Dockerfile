FROM node:22.17.0-alpine AS build

WORKDIR /app

COPY package.json package-lock.json tsconfig.json ./
RUN npm ci

COPY src ./src
COPY test ./test

RUN npm run build

FROM node:22.17.0-alpine

WORKDIR /app

COPY --from=build /app/dist ./dist
COPY package.json ./

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

USER node

CMD ["node", "dist/src/server.js"]
