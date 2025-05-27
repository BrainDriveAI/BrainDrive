import sys
import os
import pytest
import pytest_asyncio
from fastapi.testclient import TestClient
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker
from typing import AsyncGenerator, Generator

# Add the backend directory to the Python path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Override settings for testing
os.environ["DATABASE_URL"] = "sqlite+aiosqlite:///./test.db"
os.environ["ENVIRONMENT"] = "test"

from app.core.config import settings
from app.models import Base  # Import all models so tables are created
from app.core.database import Base as DBBase
from app.main import app
from app.core.database import get_db

# Create test engine
engine = create_async_engine(str(settings.DATABASE_URL), echo=True)
TestingSessionLocal = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

# Override the database dependency
async def override_get_db():
    async with TestingSessionLocal() as session:
        yield session

app.dependency_overrides[get_db] = override_get_db

@pytest_asyncio.fixture(autouse=True)
async def setup_database():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(DBBase.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
        await conn.run_sync(DBBase.metadata.create_all)
    yield
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(DBBase.metadata.drop_all)

@pytest_asyncio.fixture
async def db() -> AsyncGenerator[AsyncSession, None]:
    async with TestingSessionLocal() as session:
        yield session

@pytest.fixture
def client() -> Generator:
    with TestClient(app, base_url="http://test") as c:
        c.headers["host"] = "test"  # Set the host header to match base_url
        c.cookies.jar.clear()  # Clear any existing cookies
        yield c

@pytest_asyncio.fixture
async def async_client() -> AsyncGenerator[AsyncClient, None]:
    async with AsyncClient(app=app, base_url="http://test") as ac:
        yield ac
