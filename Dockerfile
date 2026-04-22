FROM node:bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive

RUN echo 'Acquire::Retries "5";' > /etc/apt/apt.conf.d/80-retries && \
    echo 'Acquire::http::Timeout "30";' >> /etc/apt/apt.conf.d/80-retries

RUN apt-get update && \
    apt-get install --no-install-recommends -y poppler-utils tini libnss3 libnss3-tools ca-certificates ffmpeg && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

RUN mkdir -p /root/.pki/nssdb \
    && certutil -N -d sql:/root/.pki/nssdb --empty-password

WORKDIR /app

COPY package.json package-lock.json ./

RUN npm ci

COPY . .

ENTRYPOINT ["/usr/bin/tini", "--"]

CMD ["node", "index.js"]
