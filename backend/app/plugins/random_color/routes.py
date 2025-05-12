from fastapi import APIRouter
import random

# Create router with versioned prefix and tags
router = APIRouter(
    prefix="/api/v1/plugin/random-color",
    tags=["random-color-plugin"],
    responses={404: {"description": "Not found"}},
)

@router.get(
    "/get-color",
    summary="Get Random Color",
    description="Generate a random hex color value",
    response_description="A random hex color code",
    responses={
        200: {
            "description": "Successfully generated color",
            "content": {
                "application/json": {
                    "example": {"color": "#ff0000"}
                }
            }
        }
    }
)
async def get_random_color():
    """Generate a random hex color."""
    color = "#{:06x}".format(random.randint(0, 0xFFFFFF))
    return {"color": color}

@router.get(
    "/metadata",
    summary="Plugin Metadata",
    description="Get plugin metadata and configuration",
    response_description="Plugin metadata information",
    responses={
        200: {
            "description": "Successfully retrieved plugin metadata",
            "content": {
                "application/json": {
                    "example": {
                        "name": "Random Color",
                        "version": "0.1.0",
                        "description": "A plugin that generates random colors"
                    }
                }
            }
        }
    }
)
async def get_metadata():
    """Get plugin metadata."""
    return {
        "name": "Random Color",
        "version": "0.1.0",
        "description": "A plugin that generates random colors",
        "entry_point": "/plugins/static/random-color/dist/remoteEntry.js",
        "routes": [
            {
                "path": "/get-color",
                "method": "GET",
                "description": "Get a random color in hex format"
            }
        ]
    }
