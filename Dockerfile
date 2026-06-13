FROM node:24-alpine

WORKDIR /app
COPY package.json server.js ./
COPY index.html styles.css app.js manifest.webmanifest icon.svg social-card.svg googled68ecb0ee296f9ef.html ./

ENV NODE_ENV=production
EXPOSE 4173

CMD ["node", "server.js"]
