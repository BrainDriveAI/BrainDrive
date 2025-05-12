import json
import os
from typing import List, Optional
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    # Application settings
    APP_NAME: str = "BrainDrive"
    APP_ENV: str = os.getenv("APP_ENV", "dev")  # 🔥 Set from .env (default to 'dev')
    API_V1_PREFIX: str = "/api/v1"
    DEBUG: bool = os.getenv("DEBUG", "true").lower() == "true"

    # Server settings
    HOST: str = os.getenv("HOST", "0.0.0.0")
    PORT: int = int(os.getenv("PORT", 8005))
    RELOAD: bool = os.getenv("RELOAD", "true").lower() == "true"
    LOG_LEVEL: str = os.getenv("LOG_LEVEL", "info")
    PROXY_HEADERS: bool = os.getenv("PROXY_HEADERS", "true").lower() == "true"
    FORWARDED_ALLOW_IPS: str = os.getenv("FORWARDED_ALLOW_IPS", "*")
    SSL_KEYFILE: Optional[str] = os.getenv("SSL_KEYFILE", None)
    SSL_CERTFILE: Optional[str] = os.getenv("SSL_CERTFILE", None)

    # Security settings
    SECRET_KEY: str = os.getenv("SECRET_KEY", "your-secret-key-here")
    ACCESS_TOKEN_EXPIRE_MINUTES: int = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", 30))
    REFRESH_TOKEN_EXPIRE_DAYS: int = int(os.getenv("REFRESH_TOKEN_EXPIRE_DAYS", 30))
    ALGORITHM: str = os.getenv("ALGORITHM", "HS256")

    # Database settings
    DATABASE_URL: str = os.getenv("DATABASE_URL", "sqlite:///braindrive.db")
    DATABASE_TYPE: str = os.getenv("DATABASE_TYPE", "sqlite")
    USE_JSON_STORAGE: bool = os.getenv("USE_JSON_STORAGE", "false").lower() == "true"
    JSON_DB_PATH: str = os.getenv("JSON_DB_PATH", "./storage/database.json")
    SQL_LOG_LEVEL: str = os.getenv("SQL_LOG_LEVEL", "WARNING")

    # Redis settings
    USE_REDIS: bool = os.getenv("USE_REDIS", "false").lower() == "true"
    REDIS_HOST: str = os.getenv("REDIS_HOST", "localhost")
    REDIS_PORT: int = int(os.getenv("REDIS_PORT", 6379))

    # CORS settings (Convert JSON strings to lists)
    CORS_ORIGINS: str = os.getenv("CORS_ORIGINS", '["http://localhost:3000", "http://10.0.2.149:3000", "https://braindrive.ijustwantthebox.com"]')
    CORS_METHODS: str = os.getenv("CORS_METHODS", '["GET", "POST", "PUT", "DELETE", "OPTIONS", "HEAD"]')
    CORS_HEADERS: str = os.getenv("CORS_HEADERS", '["Authorization", "Content-Type", "Accept", "Origin", "X-Requested-With"]')
    CORS_EXPOSE_HEADERS: Optional[str] = os.getenv("CORS_EXPOSE_HEADERS", None)
    CORS_MAX_AGE: int = int(os.getenv("CORS_MAX_AGE", 3600))
    CORS_ALLOW_CREDENTIALS: bool = os.getenv("CORS_ALLOW_CREDENTIALS", "true").lower() == "true"

    # Allowed Hosts
    ALLOWED_HOSTS: str = os.getenv("ALLOWED_HOSTS", '["localhost", "127.0.0.1", "10.0.2.149", "braindrive.ijustwantthebox.com"]')

    @property
    def cors_origins_list(self) -> List[str]:
        return json.loads(self.CORS_ORIGINS)

    @property
    def cors_methods_list(self) -> List[str]:
        return json.loads(self.CORS_METHODS)

    @property
    def cors_headers_list(self) -> List[str]:
        return json.loads(self.CORS_HEADERS)

    @property
    def cors_expose_headers_list(self) -> Optional[List[str]]:
        return json.loads(self.CORS_EXPOSE_HEADERS) if self.CORS_EXPOSE_HEADERS else None

    @property
    def allowed_hosts_list(self) -> List[str]:
        return json.loads(self.ALLOWED_HOSTS)

    @property
    def is_production(self) -> bool:
        return self.APP_ENV == "prod"  # 🔥 This makes it easy to check if we're in production

    model_config = {
        "env_file": ".env",
        "env_file_encoding": "utf-8",
        "case_sensitive": True,
        "extra": "ignore"  # Allow extra fields in the environment that aren't defined in the Settings class
    }

settings = Settings()

__all__ = ["settings"]
