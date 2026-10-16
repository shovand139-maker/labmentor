"""ASGI entry point: uvicorn labmentor_assistant.main:app"""

import logging
import os

from .app import create_app

logging.basicConfig(
    level=os.environ.get("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)

app = create_app()
