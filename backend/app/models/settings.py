from sqlalchemy import Column, String, DateTime, Boolean, JSON, ForeignKey, Enum, func, select, ARRAY
from sqlalchemy.orm import relationship
from app.models.base import Base
from app.core.encrypted_column import create_encrypted_column
from datetime import datetime
from uuid import uuid4
import enum
# Remove direct import of User to avoid circular dependency
from app.models.page import Page  # Import Page model for relationship
from pydantic import BaseModel
from typing import Any, Optional, Union

class SettingScope(str, enum.Enum):
    SYSTEM = "system"
    USER = "user"
    PAGE = "page"
    USER_PAGE = "user_page"  # Special scope for user-specific page settings
    
    @classmethod
    def _missing_(cls, value):
        """Handle case-insensitive enum values."""
        if isinstance(value, str):
            # Try to match case-insensitively
            for member in cls:
                if member.value.lower() == value.lower():
                    return member
        return None

class SettingDefinition(Base):
    __tablename__ = "settings_definitions"

    id = Column(String(32), primary_key=True, default=lambda: str(uuid4()).replace('-', ''))
    name = Column(String, nullable=False)
    description = Column(String, nullable=True)
    category = Column(String, nullable=False)
    type = Column(String, nullable=False)  # 'string', 'number', 'boolean', 'object', 'array'
    default_value = Column(JSON, nullable=True)
    allowed_scopes = Column(JSON, nullable=False)  # JSON array of allowed scopes
    validation = Column(JSON, nullable=True)
    is_multiple = Column(Boolean, default=False)
    tags = Column(JSON, nullable=True)  # Array of strings
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())

    instances = relationship("SettingInstance", back_populates="definition", cascade="all, delete-orphan")

    @classmethod
    async def get_by_id(cls, db, id: str):
        query = select(cls).where(cls.id == id)
        result = await db.execute(query)
        return result.scalar_one_or_none()

    @classmethod
    async def get_by_name(cls, db, name: str):
        query = select(cls).where(cls.name == name)
        result = await db.execute(query)
        return result.scalar_one_or_none()

    @classmethod
    async def get_all(cls, db, category: str = None, scope: str = None):
        query = select(cls)
        if category:
            query = query.where(cls.category == category)
        if scope:
            query = query.where(cls.allowed_scopes.contains([scope]))
        result = await db.execute(query)
        return result.scalars().all()

    async def save(self, db):
        try:
            db.add(self)
            await db.commit()
            await db.refresh(self)
            return self
        except Exception as e:
            import logging
            logging.getLogger(__name__).error(f"Error in save: {e}")
            await db.rollback()
            # Re-raise the exception for the caller to handle
            raise

class SettingInstance(Base):
    __tablename__ = "settings_instances"
    
    # Control the order of mapper configuration to avoid circular dependencies
    __mapper_args__ = {
        'confirm_deleted_rows': False  # This forces SQLAlchemy to load this mapper later
    }

    id = Column(String(32), primary_key=True, default=lambda: str(uuid4()).replace('-', ''))
    definition_id = Column(String(32), ForeignKey("settings_definitions.id"), nullable=False)
    name = Column(String, nullable=False)
    value = Column(create_encrypted_column("settings_instances", "value"), nullable=True)
    scope = Column(Enum(SettingScope), nullable=False)
    user_id = Column(String(32), ForeignKey("users.id"), nullable=True)
    page_id = Column(String(32), ForeignKey("pages.id"), nullable=True)  # Reference to page ID
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())

    definition = relationship("SettingDefinition", back_populates="instances")
    # Remove relationship to User model to avoid circular dependency
    # user_id is just a string reference, not a direct relationship
    # Remove relationship to Page model to avoid circular dependency
    # page_id is just a string reference, not a direct relationship

    @classmethod
    async def get_by_id(cls, db, id: str):
        query = select(cls).where(cls.id == id)
        result = await db.execute(query)
        return result.scalar_one_or_none()

    @classmethod
    async def get_by_context(cls, db, scope: SettingScope, user_id: str = None, page_id: str = None):
        """Get settings based on context."""
        try:
            query = select(cls).where(cls.scope == scope)
            
            if scope == SettingScope.USER and user_id:
                query = query.where(cls.user_id == user_id)
            elif scope == SettingScope.PAGE and page_id:
                query = query.where(cls.page_id == page_id)
            elif scope == SettingScope.USER_PAGE and user_id and page_id:
                query = query.where(cls.user_id == user_id, cls.page_id == page_id)
                
            result = await db.execute(query)
            return result.scalars().all()
        except Exception as e:
            import logging
            logging.getLogger(__name__).error(f"Error in get_by_context: {e}")
            # Return empty list instead of raising an exception
            return []

    @classmethod
    async def get_all_parameterized(cls, db, definition_id: str = None, scope: str = None, user_id: str = None, page_id: str = None):
        """Get all settings instances with optional filters using parameterized queries."""
        import logging
        logger = logging.getLogger(__name__)
        
        logger.info(f"Getting all settings with parameterized query: definition_id={definition_id}, scope={scope}, user_id={user_id}, page_id={page_id}")
        
        # Use SQLAlchemy's query builder with parameters to prevent SQL injection
        query = select(cls)
        
        if definition_id:
            query = query.where(cls.definition_id == definition_id)
        if scope:
            # Prefer ORM with enum conversion so encrypted columns decrypt automatically
            try:
                enum_scope = None
                if isinstance(scope, SettingScope):
                    enum_scope = scope
                elif isinstance(scope, str):
                    for s in SettingScope:
                        if s.value.lower() == scope.lower():
                            enum_scope = s
                            break
                if enum_scope:
                    logger.info(f"Converted scope '{scope}' to enum value '{enum_scope}' for ORM query")
                    if isinstance(enum_scope, SettingScope) and enum_scope == SettingScope.USER:
                        logger.info("Legacy data stores 'user' in lowercase; using direct SQL fallback for USER scope")
                        return await cls.get_all(db, definition_id, scope, user_id, page_id)
                    scope_value = enum_scope.value if isinstance(enum_scope, SettingScope) else enum_scope
                    logger.debug(f"Filtering settings by scope value '{scope_value}'")
                    query = query.where(cls.scope == scope_value)
                else:
                    logger.warning(f"Could not convert scope '{scope}' to enum; falling back to direct SQL query")
                    # Fallback to direct SQL (returns dictionaries; may bypass decryption)
                    return await cls.get_all(db, definition_id, scope, user_id, page_id)
            except Exception as e:
                logger.error(f"Error applying scope filter via ORM: {e}; falling back to direct SQL query")
                return await cls.get_all(db, definition_id, scope, user_id, page_id)
        if user_id:
            query = query.where(cls.user_id == user_id)
        if page_id:
            query = query.where(cls.page_id == page_id)
        
        try:
            # Execute the query with proper parameter binding
            result = await db.execute(query)
            instances = result.scalars().all()
            
            logger.info(f"Parameterized query found {len(instances)} instances")
            return instances
        except Exception as e:
            logger.error(f"Error in parameterized query: {e}")
            import traceback
            logger.error(traceback.format_exc())
            # Return empty list instead of raising an exception
            return []
    
    @classmethod
    async def get_all(cls, db, definition_id: str = None, scope: str = None, user_id: str = None, page_id: str = None):
        """Get all settings instances with optional filters (legacy method, uses direct SQL)."""
        import logging
        logger = logging.getLogger(__name__)
        
        logger.info(f"Getting all settings with filters: definition_id={definition_id}, scope={scope}, user_id={user_id}, page_id={page_id}")
        logger.warning("Using deprecated get_all method with direct SQL. Consider using get_all_parameterized instead.")
        
        # Build SQL query directly
        from sqlalchemy import text
        
        conditions = []
        if definition_id:
            conditions.append(f"definition_id = '{definition_id}'")
        if scope:
            # Use case-insensitive comparison for scope
            conditions.append(f"LOWER(scope) = LOWER('{scope}')")
        if user_id:
            conditions.append(f"user_id = '{user_id}'")
        if page_id:
            conditions.append(f"page_id = '{page_id}'")
            
        where_clause = " AND ".join(conditions) if conditions else "1=1"
        query = f"""
        SELECT * FROM settings_instances
        WHERE {where_clause}
        """
        
        logger.info(f"Direct SQL query: {query}")
        
        try:
            result = await db.execute(text(query))
            rows = result.fetchall()
            logger.info(f"Direct SQL query found {len(rows)} rows")
            
            # Return rows as dictionaries instead of trying to create SettingInstance objects
            # This avoids triggering SQLAlchemy's mapper initialization
            instances = []
            for row in rows:
                # Create a dict from the row
                row_dict = {column: value for column, value in row._mapping.items()}
                logger.debug(f"Row dict: {row_dict}")
                instances.append(row_dict)
            
            logger.info(f"Converted {len(instances)} rows to dictionaries")
            return instances
        except Exception as e:
            logger.error(f"Error in direct SQL query: {e}")
            import traceback
            logger.error(traceback.format_exc())
            return []

    @classmethod
    async def create_with_sql(cls, db, data):
        """Create a setting instance using direct SQL to avoid ORM issues."""
        try:
            from sqlalchemy import insert
            stmt = insert(cls.__table__).values(**data)
            result = await db.execute(stmt)
            await db.commit()
            # Return the data as a dict since we can't get a proper instance
            return data
        except Exception as e:
            import logging
            logging.getLogger(__name__).error(f"Error in create_with_sql: {e}")
            await db.rollback()
            raise

    async def save(self, db):
        try:
            db.add(self)
            await db.commit()
            await db.refresh(self)
            return self
        except Exception as e:
            import logging
            logging.getLogger(__name__).error(f"Error in save: {e}")
            await db.rollback()
            # Re-raise the exception for the caller to handle
            raise

class SettingInstanceCreate(BaseModel):
    """Schema for creating a setting instance."""
    definition_id: str
    name: str
    value: Any
    scope: Union[str, SettingScope]
    user_id: Optional[str] = None
    page_id: Optional[str] = None
    id: Optional[str] = None  # For updates
    action: Optional[str] = None  # For delete operations

    @property
    def context_valid(self) -> bool:
        if self.scope == SettingScope.USER and not self.user_id:
            return False
        if self.scope == SettingScope.PAGE and not self.page_id:
            return False
        if self.scope == SettingScope.USER_PAGE and not self.user_id and not self.page_id:
            return False
        return True
