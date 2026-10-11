# The fleet archive compactor, run hourly as a Kubernetes CronJob.
#   docker build -t metro-archive ops/archive
FROM python:3.12-slim
RUN pip install --no-cache-dir duckdb==1.5.6 \
 && useradd --create-home archive
USER archive
WORKDIR /home/archive
# Installed now so each hourly run doesn't download the extension again.
RUN python -c "import duckdb; duckdb.sql('INSTALL httpfs')"
COPY --chown=archive compact.py sigv4.py ./
CMD ["python", "compact.py"]
