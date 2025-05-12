from logging.config import fileConfig

from sqlalchemy import engine_from_config
from sqlalchemy import pool
from sqlalchemy.ext.asyncio import async_engine_from_config

from alembic import context

import os
import sys
import asyncio
from dotenv import load_dotenv

# Add the parent directory to Python path
sys.path.append(os.path.dirname(os.path.dirname(__file__)))

# Load environment variables from .env file
load_dotenv()

# Import your models and database configuration
from app.core.config import settings as config_settings  # Rename to avoid conflict
from app.core.database import Base

# Import all models through __init__.py to ensure all models and relationships are loaded
from app.models import *

# Add debug logging
import logging
logger = logging.getLogger("alembic.autogenerate")
logger.setLevel(logging.DEBUG)

# Function to help resolve table names
def get_table_name(table_name):
    """
    This function helps resolve table names, handling any special cases.
    
    Args:
        table_name: The name of the table
        
    Returns:
        The resolved table name
    """
    # Handle special cases for table names
    table_map = {
        "users": "users",
        "pages": "pages",
        # Add more mappings if needed
    }
    
    return table_map.get(table_name, table_name)

# Function to determine which objects to include in autogenerate
def include_object(object, name, type_, reflected, compare_to):
    """
    This function determines which database objects should be included in the autogenerate process.
    
    Args:
        object: The SQLAlchemy object being considered
        name: The name of the object
        type_: The type of object (table, column, etc.)
        reflected: Whether the object was reflected from the database
        compare_to: The object being compared to, if any
        
    Returns:
        True if the object should be included, False otherwise
    """
    # Log the object being considered
    logger.debug(f"Considering {type_} {name}, reflected: {reflected}")
    
    # Exclude certain tables if needed
    if type_ == "table" and name == "alembic_version":
        return False
        
    # Handle special cases for foreign keys
    if type_ == "foreign_key_constraint":
        logger.debug(f"Foreign key constraint: {name}")
        # You can add special handling for foreign keys here
        
    return True

# this is the Alembic Config object, which provides
# access to the values within the .ini file in use.
config = context.config

# Interpret the config file for Python logging.
# This line sets up loggers basically.
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Set the database URL in the alembic configuration
config.set_main_option("sqlalchemy.url", str(config_settings.DATABASE_URL))

# add your model's MetaData object here
# for 'autogenerate' support
target_metadata = Base.metadata

def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode."""
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        include_object=include_object,
        include_schemas=True
    )

    with context.begin_transaction():
        context.run_migrations()

def do_run_migrations(connection):
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        compare_type=True,
        include_object=include_object,
        include_schemas=True
    )

    with context.begin_transaction():
        context.run_migrations()

def run_migrations_online() -> None:
    """Run migrations in 'online' mode."""
    # Check if we're using SQLite
    url = str(config_settings.DATABASE_URL)
    is_sqlite = url.startswith('sqlite')
    
    if is_sqlite:
        # Use synchronous engine for SQLite
        configuration = config.get_section(config.config_ini_section)
        configuration["sqlalchemy.url"] = url
        connectable = engine_from_config(
            configuration,
            prefix="sqlalchemy.",
            poolclass=pool.NullPool,
        )
        
        with connectable.connect() as connection:
            context.configure(
                connection=connection,
                target_metadata=target_metadata,
                compare_type=True,
                render_as_batch=True,  # Use batch mode for SQLite
                include_object=include_object,
                include_schemas=True
            )
            
            with context.begin_transaction():
                context.run_migrations()
    else:
        # Use async engine for other databases
        async def run_async_migrations() -> None:
            """In this scenario we need to create an Engine
            and associate a connection with the context.
            """
            configuration = config.get_section(config.config_ini_section)
            configuration["sqlalchemy.url"] = url
            connectable = async_engine_from_config(
                configuration,
                prefix="sqlalchemy.",
                poolclass=pool.NullPool,
            )

            async with connectable.connect() as connection:
                await connection.run_sync(do_run_migrations)

            await connectable.dispose()
            
        asyncio.run(run_async_migrations())

if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
