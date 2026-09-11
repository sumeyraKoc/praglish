FROM python:3.11-slim

WORKDIR /app

COPY ai/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY ai/ .
COPY shared/ ./shared

EXPOSE 8001

# api/Dockerfile'daki ile ayni sebep: Render (veya baska bir PaaS) kendi
# PORT degiskenini enjekte eder ve container'in ONA bagli olmasini bekler.
# ${PORT:-8001} sayesinde yerel docker-compose'da (PORT tanimli degil)
# hala 8001'de dinler; Compose gelistirme ortaminda --reload komutunu ayrica
# tanimlar. Production ise reload olmadan platformun verdigi PORT'u kullanir.
CMD ["sh", "-c", "exec uvicorn main:app --host 0.0.0.0 --port \"${PORT:-8001}\""]
