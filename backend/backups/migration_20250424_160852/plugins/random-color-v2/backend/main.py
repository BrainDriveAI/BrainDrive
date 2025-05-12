from fastapi import APIRouter
from typing import Dict, Any
import random

class RandomColorPlugin:
    def __init__(self, config: Dict[str, Any] = None):
        self.router = APIRouter()
        self.config = config or {}
        self._setup_routes()

    def _setup_routes(self):
        @self.router.get("/random")
        async def get_random_color():
            """Generate a random color in hex format"""
            color = "#{:06x}".format(random.randint(0, 0xFFFFFF))
            return {"color": color}

    def initialize(self):
        """Called when the plugin is initialized"""
        pass

    def cleanup(self):
        """Called when the plugin is being unloaded"""
        pass
