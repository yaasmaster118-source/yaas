FROM node:24-alpine

WORKDIR /app
COPY package.json server.js ./
RUN npm install --omit=dev
COPY src ./src
COPY scripts ./scripts
COPY schema.sql ./
COPY index.html styles.css app.js manifest.webmanifest icon.svg social-card.svg googled68ecb0ee296f9ef.html ./

ENV NODE_ENV=production
EXPOSE 4173

CMD ["node", "server.js"]
