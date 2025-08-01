from fastapi import APIRouter
from app.api.v1.endpoints import auth, settings, ollama, ai_providers, ai_provider_settings, navigation_routes, components, conversations, tags, personas, plugin_state, demo
from app.routers import plugins
from app.routes.pages import router as pages_router

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
api_router.include_router(personas.router, tags=["personas"])
api_router.include_router(plugin_state.router, tags=["plugin-state"])
api_router.include_router(demo.router, tags=["demo"])
# Include the plugins router (which already includes the lifecycle router)
api_router.include_router(plugins.router, tags=["plugins"])
api_router.include_router(pages_router)
