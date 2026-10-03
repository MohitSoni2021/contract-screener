# ── Stage 1: dependency builder ────────────────────────────────────────────────
# Use a slim Python base just for installing wheels so the final image stays lean.
FROM python:3.12-slim AS builder

# Never write .pyc files to disk; keep stdout/stderr unbuffered for Docker logs.
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /build

# Install only the OS-level tools required to compile native extensions
# (PyMuPDF / argon2-cffi both need gcc + libffi).
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
        libffi-dev \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements first so Docker layer-caches the install step
# as long as requirements.txt doesn't change.
COPY requirements.txt .

# Build wheels into /build/wheels. Exclude dev-only deps (pytest).
RUN pip install --upgrade pip && \
    pip wheel --no-cache-dir --wheel-dir /build/wheels \
        $(grep -v '^\s*#' requirements.txt | grep -v '^\s*pytest' | grep -v '^\s*$')


# ── Stage 2: runtime image ─────────────────────────────────────────────────────
FROM python:3.12-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    # Keep pip quiet; we only install from pre-built wheels below.
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# Create a non-root user for security.
RUN groupadd --gid 1001 appgroup && \
    useradd  --uid 1001 --gid appgroup --no-create-home appuser

WORKDIR /app

# Install OS runtime libs needed by PyMuPDF (libmupdf) and argon2-cffi (libffi).
RUN apt-get update && apt-get install -y --no-install-recommends \
        libffi8 \
    && rm -rf /var/lib/apt/lists/*

# Install pre-built wheels from the builder stage — no compiler needed here.
COPY --from=builder /build/wheels /tmp/wheels
RUN pip install --no-index --find-links=/tmp/wheels /tmp/wheels/*.whl && \
    rm -rf /tmp/wheels

# Copy only the application source.
COPY main.py .
COPY app/   ./app/
COPY start.sh .

# Own everything as our non-root user and ensure start.sh is executable.
RUN chmod +x start.sh && chown -R appuser:appgroup /app

USER appuser

# FastAPI / Uvicorn listens on 8000 by default.
EXPOSE 8000

# Health-check so orchestrators (Compose / K8s) know when the service is ready.
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/api/health')"

CMD ["./start.sh"]
