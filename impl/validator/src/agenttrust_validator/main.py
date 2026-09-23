"""Entry point: `uv run python -m agenttrust_validator.main`."""

from __future__ import annotations

import uvicorn

from .app import create_app
from .config import Settings


def main() -> None:
    settings = Settings()  # type: ignore[call-arg] - pydantic-settings reads the env
    app = create_app(settings)
    uvicorn.run(app, host="127.0.0.1", port=8088)


if __name__ == "__main__":
    main()
