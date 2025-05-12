import asyncio
import os
import logging
import uuid
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from sqlalchemy.engine.url import make_url
from app.core.config import settings
from app.models import Base
from app.models.component import Component
from app.models.navigation import NavigationRoute
from app.models.user import User
import subprocess

logger = logging.getLogger(__name__)

async def init_system_components(db: AsyncSession):
    """Initialize system components if they don't exist."""
    try:
        logger.info("Initializing system components...")
        
        # Define system components
        system_components = [
            {
                "name": "Dashboard",
                "component_id": "dashboard",
                "description": "Main dashboard component",
                "icon": "Dashboard",
                "is_system": True
            },
            {
                "name": "Plugin Studio",
                "component_id": "plugin-studio",
                "description": "Plugin development environment",
                "icon": "Extension",
                "is_system": True
            },
            {
                "name": "Settings",
                "component_id": "settings",
                "description": "System settings",
                "icon": "Settings",
                "is_system": True
            }
        ]
        
        # Get or create system components
        for component_data in system_components:
            existing_component = await Component.get_by_component_id(db, component_data["component_id"])
            
            if existing_component:
                # Update existing component
                logger.info(f"Updating existing component: {component_data['component_id']}")
                for key, value in component_data.items():
                    setattr(existing_component, key, value)
                db.add(existing_component)
            else:
                # Create new component
                logger.info(f"Creating new component: {component_data['component_id']}")
                new_component = Component(**component_data)
                db.add(new_component)
        
        await db.commit()
        logger.info("✅ System components initialized successfully")
    except Exception as e:
        await db.rollback()
        logger.error(f"❌ Failed to initialize system components: {e}")
        raise

async def init_system_routes_old(db: AsyncSession):
    """Initialize system routes if they don't exist."""
    try:
        logger.info("Initializing system routes...")
        
        # First ensure system components exist
        await init_system_components(db)
        
        # Get system user for creator_id
        system_user = await User.get_system_user(db)
        if not system_user:
            logger.warning("System user not found, using first admin user")
            # Try to get an admin user
            admin_users = await db.execute("SELECT * FROM users WHERE is_superuser = TRUE LIMIT 1")
            system_user = admin_users.fetchone()
            if not system_user:
                logger.error("No admin user found, cannot initialize system routes")
                return
        
        # Define system routes
        system_routes = [
            {
                "name": "Your BrainDrive",
                "route": "dashboard",
                "icon": "Dashboard",
                "description": "Your BrainDrive dashboard",
                "order": 10,
                "is_visible": True,
                "is_system_route": True,
                "default_component_id": "dashboard"
            },
            {
                "name": "BrainDrive Studio",
                "route": "plugin-studio",
                "icon": "Extension",
                "description": "BrainDrive Studio for creating and managing plugins",
                "order": 20,
                "is_visible": True,
                "is_system_route": True,
                "default_component_id": "plugin-studio"
            },
            {
                "name": "Settings",
                "route": "settings",
                "icon": "Settings",
                "description": "BrainDrive settings",
                "order": 30,
                "is_visible": True,
                "is_system_route": True,
                "default_component_id": "settings"
            }
        ]
        
        # Create or update system routes
        for route_data in system_routes:
            # Check if route exists
            existing_route = await NavigationRoute.get_by_route(db, route_data["route"])
            
            if existing_route:
                # Update existing route
                logger.info(f"Updating existing route: {route_data['route']}")
                for key, value in route_data.items():
                    setattr(existing_route, key, value)
                existing_route.creator_id = system_user.id
                await existing_route.save(db)
            else:
                # Create new route
                logger.info(f"Creating new route: {route_data['route']}")
                new_route = NavigationRoute(
                    **route_data,
                    creator_id=system_user.id
                )
                await new_route.save(db)
        
        logger.info("✅ System routes initialized successfully")
    except Exception as e:
        logger.error(f"❌ Failed to initialize system routes: {e}")
        raise

async def init_db():
    """Initialize the database using Alembic migrations."""
    try:
        # Parse and validate the database URL
        url = make_url(settings.DATABASE_URL)
        if settings.DATABASE_TYPE == "sqlite" and url.drivername == "sqlite":
            url = url.set(drivername="sqlite+aiosqlite")
        
        # Create the database directory if it doesn't exist (for SQLite)
        db_path = os.path.dirname(str(url).replace('sqlite+aiosqlite:///', ''))
        if db_path and not os.path.exists(db_path):
            os.makedirs(db_path)
            logger.info(f"✅ Created database directory: {db_path}")
        
        # Check if database file exists for SQLite
        if settings.DATABASE_TYPE == "sqlite":
            db_file = str(url.database)
            if not os.path.exists(db_file):
                open(db_file, 'a').close()
                logger.info(f"✅ Created empty SQLite DB at {db_file}")
        
        # ✅ RUN ALEMBIC MIGRATIONS INSTEAD OF create_all
        logger.info("Running Alembic migrations to initialize database...")
        subprocess.run(["alembic", "upgrade", "head"], check=True)
        logger.info("✅ Alembic migrations applied successfully")

    except Exception as e:
        logger.error(f"❌ Failed to initialize database: {e}")
        raise

async def init_system_data(db_url=None):
    """Initialize system data after database is created."""
    try:
        # Parse and validate the database URL
        url = make_url(db_url or settings.DATABASE_URL)
        if settings.DATABASE_TYPE == "sqlite" and url.drivername == "sqlite":
            url = url.set(drivername="sqlite+aiosqlite")
        
        # Create async engine
        engine = create_async_engine(
            url,
            echo=settings.DEBUG and getattr(logging, settings.SQL_LOG_LEVEL.upper(), logging.WARNING) <= logging.DEBUG,
            connect_args={"check_same_thread": False} if settings.DATABASE_TYPE == "sqlite" else {}
        )
        
        # Create session
        async_session = sessionmaker(
            engine, class_=AsyncSession, expire_on_commit=False
        )
        
        # async with async_session() as session:
            # Initialize system components and routes
        #    await init_system_routes(session)
            
        await engine.dispose()
        logger.info("✅ System data initialized successfully")
    except Exception as e:
        logger.error(f"❌ Failed to initialize system data: {e}")
        raise

def init_db_sync():
    """Synchronous wrapper for database initialization."""
    asyncio.run(init_db())
    # asyncio.run(init_system_data())

if __name__ == "__main__":
    init_db_sync()
