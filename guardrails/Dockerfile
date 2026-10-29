# Local Edition guardrails sidecar (NeMo Guardrails 0.24.1). Port 8000, non-root.
# Fits Cloudflare Containers or Fly.io (1 GB machine). Secrets come from the platform environment:
#   NEBIUS_API_KEY (optional, enables the brand-voice rail), GUARDRAILS_TOKEN (optional shared secret).
FROM python:3.11-slim AS build
COPY --from=ghcr.io/astral-sh/uv:0.8.5 /uv /usr/local/bin/uv
WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=never
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev

FROM python:3.11-slim
RUN useradd --create-home --uid 10001 rails
WORKDIR /app
COPY --from=build /app/.venv /app/.venv
COPY --chown=rails:rails config.py /app/config.py
COPY --chown=rails:rails localedition /app/localedition
ENV PATH="/app/.venv/bin:$PATH" PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
USER rails
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/v1/health', timeout=4).status == 200 else 1)"
CMD ["nemoguardrails", "server", "--config", "/app/", "--port", "8000", "--default-config-id", "localedition", "--disable-chat-ui"]
