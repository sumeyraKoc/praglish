FROM python:3.11-slim

WORKDIR /app

COPY ai/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY ai/ .
COPY shared/ ./shared

EXPOSE 8001

# Render and other PaaS providers inject PORT and expect the container to bind
# to it. ${PORT:-8001} keeps port 8001 as the local Docker Compose default;
# Compose supplies its own --reload command for development, while production
# uses the platform-provided port without reload.
CMD ["sh", "-c", "exec uvicorn main:app --host 0.0.0.0 --port \"${PORT:-8001}\""]
