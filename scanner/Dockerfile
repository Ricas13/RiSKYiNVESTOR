FROM python:3.12-alpine

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    SCANNER_CONFIG_DIR=/scanner/config \
    SCANNER_OUTPUT_DIR=/scanner/output \
    SCANNER_STATE_DIR=/scanner/state \
    SCANNER_INTERVAL_SECONDS=3600

RUN addgroup -S -g 10001 scanner \
    && adduser -S -D -H -u 10001 -G scanner scanner \
    && mkdir -p /scanner/config /scanner/output /scanner/state \
    && chown -R scanner:scanner /scanner

WORKDIR /scanner/app
COPY pyproject.toml ./
COPY src ./src
RUN pip install --no-cache-dir .

USER scanner
ENTRYPOINT ["python", "-m", "risky_investor_scanner"]
CMD ["--loop"]
