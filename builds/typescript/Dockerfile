FROM node:22-bookworm-slim

LABEL braindrive.version="v0.0.1"

RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV BRAINDRIVE_BIND_ADDRESS=0.0.0.0 \
    BRAINDRIVE_PORT=8787 \
    BRAINDRIVE_TRUST_PROXY=true

COPY package.json tsconfig.json ./
RUN npm install

COPY . .

RUN npm run build

EXPOSE 8787

CMD ["node", "dist/main.js"]
