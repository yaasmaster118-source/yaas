FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
ENV FFPROBE_BIN=/usr/bin/ffprobe

WORKDIR /app
COPY package.json package-lock.json server.js ./
RUN npm ci --omit=dev --ignore-scripts
COPY src ./src
COPY scripts ./scripts
COPY assets ./assets
COPY schema.sql ./
COPY index.html styles.css clean.css app.js account-ui.js dm-composer.js dm-catalog.js auth-entrance.js auth-entrance.css studio.js studio.css studio-window.js manifest.webmanifest icon.svg social-card.svg googled68ecb0ee296f9ef.html ./

ENV NODE_ENV=production
EXPOSE 4173

CMD ["node", "server.js"]
