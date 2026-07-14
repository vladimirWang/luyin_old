# FROM ghcr.io/astral-sh/uv:python3.13-bookworm-slim
FROM python:3.13-slim-bookworm

WORKDIR /app

# 配置清华镜像源
ENV UV_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple

# 用 PyPI 安装 uv，避免构建时访问 ghcr.io（国内易超时）
RUN pip install --no-cache-dir uv==0.11.7 \
  -i https://pypi.tuna.tsinghua.edu.cn/simple

COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

COPY . .

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
