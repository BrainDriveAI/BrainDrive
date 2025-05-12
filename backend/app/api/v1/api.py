from fastapi import APIRouter
from app.api.v1.endpoints import auth, settings, ollama, ai_providers, ai_provider_settings, navigation_routes, components, conversations, tags
from app.routers import plugins

api_router = APIRouter(prefix="/api/v1")
api_router.include_router(auth.router, tags=["auth"])
api_router.include_router(settings.router, tags=["settings"])
api_router.include_router(ollama.router, prefix="/ollama", tags=["ollama"])  # Keep for backward compatibility
api_router.include_router(ai_providers.router, prefix="/ai/providers", tags=["ai"])
api_router.include_router(ai_provider_settings.router, prefix="/ai/settings", tags=["ai", "settings"])
api_router.include_router(navigation_routes.router, prefix="/navigation-routes", tags=["navigation"])
api_router.include_router(components.router, prefix="/components", tags=["components"])
api_router.include_router(conversations.router, tags=["conversations"])
api_router.include_router(tags.router, tags=["tags"])
# Include the plugins router with a prefix
api_router.include_router(plugins.router, tags=["plugins"])
