# Build stage — installs compile-time deps and builds the venv
FROM python:3.11-slim AS builder

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential libpq-dev \
    && rm -rf /var/lib/apt/lists/*

RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir -r requirements.txt

# Runtime stage — lean image without build tools
FROM python:3.11-slim

WORKDIR /app

# MALLOC_ARENA_MAX=2: glibc creates per-thread malloc arenas that inflate RSS
# in threaded workloads (uvicorn + asyncio.to_thread); cap them for the 512MB host.
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app \
    PATH="/opt/venv/bin:$PATH" \
    MALLOC_ARENA_MAX=2

# tesseract-ocr + language data power receipt scanning; poppler-utils lets
# pdf2image rasterise PDF receipts before OCR. chi-tra is not optional here —
# the app is zh-TW and most receipts it will see are Traditional Chinese, which
# the English model cannot read at all. Together these add roughly 60MB.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        libpq5 curl \
        tesseract-ocr tesseract-ocr-eng tesseract-ocr-chi-tra \
        poppler-utils \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /opt/venv /opt/venv
COPY . .

# /app/uploads exists in the image so a fresh named volume mounted there copies
# its aspiro ownership instead of coming up root-owned.
RUN useradd --create-home --shell /bin/bash aspiro \
    && mkdir -p /app/uploads \
    && chown -R aspiro:aspiro /app
USER aspiro

EXPOSE 8000

# The commit this image was built from, reported by /health. Last, so a new SHA only
# invalidates these metadata layers and never the venv or source layers above.
ARG GIT_SHA=unknown
ENV GIT_SHA=${GIT_SHA}
LABEL org.opencontainers.image.revision=${GIT_SHA}

HEALTHCHECK --interval=30s --timeout=30s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:${PORT:-8000}/health || exit 1

CMD ["sh", "-c", "exec python -m uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers --forwarded-allow-ips='*' --workers 1 --limit-concurrency 20 --timeout-keep-alive 30"]
