# Built once, on first Docker-tier use (sandbox.py:_ensure_image), then reused —
# every actual query_spreadsheet call runs with --network none, so this is the only
# point where the sandbox needs network access at all.
FROM python:3.12-slim
RUN pip install --no-cache-dir pandas
