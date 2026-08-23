# syntax=docker/dockerfile:1.7

FROM rust:1.94.1-bookworm AS builder

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        build-essential \
        clang \
        libatomic1 \
        libdbus-1-dev \
        libpipewire-0.3-dev \
        libssl-dev \
        pkg-config \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /src
COPY . .

RUN --mount=type=cache,id=aura-api-cargo-registry,target=/usr/local/cargo/registry \
    --mount=type=cache,id=aura-api-cargo-git,target=/usr/local/cargo/git \
    --mount=type=cache,id=aura-api-target,target=/src/target \
    cargo build \
        --locked \
        --release \
        --no-default-features \
        --features stable-channel \
        --package aura-os-server \
        --bin aura-os-server \
    && cp target/release/aura-os-server /tmp/aura-os-server

FROM debian:bookworm-slim AS runtime

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        chromium \
        fonts-liberation \
        libatomic1 \
        libdbus-1-3 \
        libpipewire-0.3-0 \
        libssl3 \
        tini \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system aura \
    && useradd --system --gid aura --create-home --home-dir /home/aura aura \
    && install -d -o aura -g aura /home/aura/.local/share

COPY --from=builder /tmp/aura-os-server /usr/local/bin/aura-os-server

ENV AURA_SERVER_HOST=0.0.0.0 \
    AURA_SERVER_PORT=10000 \
    AURA_BROWSER_STARTUP_PROBE=1 \
    BROWSER_DISABLE_SANDBOX=1 \
    BROWSER_EXECUTABLE_PATH=/usr/bin/chromium \
    HOME=/home/aura

USER aura
EXPOSE 10000
STOPSIGNAL SIGTERM

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["/usr/local/bin/aura-os-server"]
