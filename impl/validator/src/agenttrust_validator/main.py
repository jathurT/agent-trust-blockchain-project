"""Entry point: `uv run python -m agenttrust_validator.main`."""

from __future__ import annotations

import uvicorn
from fastapi import FastAPI

from .app import create_app
from .config import Settings


def build() -> FastAPI:
    """Fails at import if the configuration is incomplete, which is the point."""
    return create_app(Settings())  # type: ignore[call-arg] - pydantic-settings reads the env


#: For `uvicorn agenttrust_validator.main:app`.
app = build()


def main() -> None:
    uvicorn.run(app, host="127.0.0.1", port=8088)


if __name__ == "__main__":
    main()
