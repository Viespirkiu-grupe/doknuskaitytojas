FROM node:trixie-slim

RUN apt-get update && \
    apt-get install --no-install-recommends -y poppler-utils tini && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

WORKDIR /app

COPY . .

RUN npm install

ENTRYPOINT ["/usr/bin/tini", "--"]

CMD ["node", "index.js"]
