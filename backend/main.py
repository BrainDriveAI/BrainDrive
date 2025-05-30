import os
import json
import logging
import logging.config
import yaml
import sentry_sdk
import redis
import uvicorn
import structlog
from structlog.stdlib import BoundLogger
from pathlib import Path
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware
from contextlib import asynccontextmanager

from app.core.config import settings
from app.routers import plugins
from app.routes import pages
from app.api.v1.api import api_router
from app.core.init_db import init_db
from app.models import UserRole
from app.core.database import db_factory, get_db

# Configure standard logging
logging.basicConfig(
    level=getattr(logging, settings.LOG_LEVEL.upper(), logging.INFO),
    format="%(message)s",
)

# Specifically set SQLAlchemy loggers based on environment setting
sql_log_level = getattr(logging, settings.SQL_LOG_LEVEL.upper(), logging.WARNING)
logging.getLogger('sqlalchemy.engine').setLevel(sql_log_level)
logging.getLogger('sqlalchemy.pool').setLevel(sql_log_level)
logging.getLogger('sqlalchemy.dialects').setLevel(sql_log_level)
logging.getLogger('sqlalchemy.orm').setLevel(sql_log_level)

# Configure structlog
structlog.configure(
    processors=[
        structlog.stdlib.filter_by_level,
        structlog.stdlib.add_logger_name,
        structlog.stdlib.add_log_level,
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.StackInfoRenderer(),
        structlog.processors.format_exc_info,
        structlog.processors.UnicodeDecoder(),
        structlog.dev.ConsoleRenderer()  # Use ConsoleRenderer for better readability in development
    ],
    context_class=dict,
    logger_factory=structlog.stdlib.LoggerFactory(),
    wrapper_class=structlog.stdlib.BoundLogger,
    cache_logger_on_first_use=True,
)

# Configure structured logging
logger = structlog.get_logger()

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifespan context manager for the FastAPI application."""
    try:
        # Initialize the database (without recreating tables)
        await init_db()
        logger.info("✅ Database initialized successfully")

        # Create default roles if they don't exist
        async with db_factory.session_factory() as session:
            default_roles = [
                {"role_name": "admin", "description": "Administrator", "is_global": True},
                {"role_name": "member", "description": "Regular member", "is_global": True},
                {"role_name": "viewer", "description": "Read-only access", "is_global": True}
            ]
            
            for role_data in default_roles:
                result = await session.execute(
                    select(UserRole).where(UserRole.role_name == role_data["role_name"])
                )
                role = result.scalar_one_or_none()
                
                if not role:
                    role = UserRole(**role_data)
                    session.add(role)
            
            await session.commit()
            logger.info("✅ Default roles created successfully")

        yield
    except Exception as e:
        logger.error(f"❌ Error during startup: {e}")
        raise
    finally:
        # Cleanup (if needed)
        if not settings.USE_JSON_STORAGE and db_factory.engine:
            await db_factory.engine.dispose()
            logger.info("✅ Database connection closed")

# Initialize FastAPI app with lifespan
app = FastAPI(
    title=settings.APP_NAME,
    version="1.0.0",
    lifespan=lifespan,
    docs_url="/api/v1/docs"
)

# ✅ 1. Move CORS Middleware to the top
app.add_middleware(
    CORSMiddleware,
    allow_origins=json.loads(settings.CORS_ORIGINS),  # Ensure it's a list
    allow_credentials=True,  # Allow cookies
    allow_methods=["*"],  # Allow all methods
    allow_headers=["*"],  # Allow all headers
)

# ✅ 2. Handle Preflight OPTIONS Requests (Fix CORS Issues)
@app.options("/{full_path:path}")
async def preflight_handler(full_path: str, response: Response):
    response.headers["Access-Control-Allow-Origin"] = ",".join(json.loads(settings.CORS_ORIGINS))
    response.headers["Access-Control-Allow-Methods"] = "OPTIONS, GET, POST, PUT, DELETE"
    response.headers["Access-Control-Allow-Headers"] = "*"
    response.headers["Access-Control-Allow-Credentials"] = "true"
    return response

class LoggingMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        logger.info("Request received", method=request.method, path=request.url.path)
        response = await call_next(request)
        logger.info("Response sent", path=request.url.path, status_code=response.status_code)
        return response

# ✅ 3. Allow All Hosts for Development (Fix 403 Issues)
app.add_middleware(
    TrustedHostMiddleware, 
    allowed_hosts=["*"]  # Allow all hosts (change in production)
)

app.add_middleware(LoggingMiddleware)
# app.add_middleware(GZipMiddleware)
# app.add_middleware(ConditionalGZipMiddleware)

# Mount static files
static_path = Path("static")
if static_path.exists():
    app.mount("/static", StaticFiles(directory=static_path), name="static")

# Include routers
app.include_router(api_router)  # Include the main API router
# app.include_router(plugins.router, prefix=settings.API_V1_PREFIX)  # This is already included in api_router
app.include_router(pages.router, prefix=settings.API_V1_PREFIX)

# Configure Sentry if DSN is provided
if hasattr(settings, 'SENTRY_DSN') and settings.SENTRY_DSN:
    sentry_sdk.init(
        dsn=settings.SENTRY_DSN,
        traces_sample_rate=1.0,
        environment=settings.APP_ENV
    )

# Configure Redis if enabled
if settings.USE_REDIS:
    try:
        redis_client = redis.Redis(
            host=settings.REDIS_HOST,
            port=settings.REDIS_PORT,
            decode_responses=True
        )
        redis_client.ping()
        logger.info("✅ Redis connection established")
    except redis.ConnectionError as e:
        logger.error(f"❌ Redis connection failed: {e}")
        redis_client = None

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.error(f"Global exception: {exc}")
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error"}
    )

@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request, exc):
    import logging
    logging.error(f"Validation Error: {exc.errors()}")
    logging.error(f"Request Body: {exc.body}")
    
    return JSONResponse(
        status_code=422,
        content={"detail": exc.errors(), "body": exc.body},
    )

@app.get("/health")
async def health_check():
    return {"status": "healthy"}

if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host=settings.HOST,
        port=settings.PORT,
        reload=settings.RELOAD,
        log_level=settings.LOG_LEVEL.lower(),
        proxy_headers=settings.PROXY_HEADERS,
        forwarded_allow_ips=settings.FORWARDED_ALLOW_IPS,
        ssl_keyfile=settings.SSL_KEYFILE,
        ssl_certfile=settings.SSL_CERTFILE
    )
