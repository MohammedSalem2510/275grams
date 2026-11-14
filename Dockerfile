FROM python:3.13-slim
WORKDIR /app
COPY dashboard/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt tzdata
COPY dashboard/ dashboard/
ENV CHIRP_HOSTED=1 CHIRP_DATA_DIR=/data
# Refresh the labelled demo data on every start (only SIMULATED rows; live station data on /data is kept),
# so the simulated stations always end "now". Then serve.
CMD ["sh", "-c", "python -m dashboard.seed_simulated && exec python -m uvicorn dashboard.server:app --host 0.0.0.0 --port ${PORT:-8000}"]
