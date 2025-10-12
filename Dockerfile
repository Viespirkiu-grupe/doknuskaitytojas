FROM node:trixie-slim

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && \
    apt-get install --no-install-recommends -y poppler-utils tini libreoffice libnss3 libnss3-tools ca-certificates && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

RUN mkdir -p /root/.pki/nssdb \
    && certutil -N -d sql:/root/.pki/nssdb --empty-password

WORKDIR /app

COPY . .

RUN npm install

ENTRYPOINT ["/usr/bin/tini", "--"]

CMD ["node", "index.js"]
