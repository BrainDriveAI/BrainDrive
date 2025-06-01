import uuid
import logging
from datetime import datetime
from sqlalchemy import Column, String, Boolean, Text, select

# Remove PostgreSQL UUID import as we're standardizing on String
from sqlalchemy.orm import relationship
from app.models.base import Base
from app.models.mixins import TimestampMixin
from app.core.database import db_factory
from app.core.json_storage import JSONStorage

logger = logging.getLogger(__name__)


class User(Base, TimestampMixin):
    __tablename__ = "users"

    id = Column(
        String(32), primary_key=True, default=lambda: str(uuid.uuid4()).replace("-", "")
    )
    username = Column(String(50), unique=True, nullable=False)
    email = Column(String(100), unique=True, nullable=False)
    hashed_password = Column(Text, nullable=False)
    full_name = Column(String(100))
    profile_picture = Column(Text)
    is_active = Column(Boolean, default=True)
    is_verified = Column(Boolean, default=False)
    refresh_token = Column(Text, nullable=True)
    refresh_token_expires = Column(Text, nullable=True)
    # New field to track user version for upgrades
    version = Column(String(20), default="0.0.0")

    # Relationships with lazy loading and string references
    tenant_users = relationship("TenantUser", back_populates="user", lazy="selectin")
    oauth_accounts = relationship(
        "OAuthAccount", back_populates="user", lazy="selectin"
    )
    sessions = relationship("Session", back_populates="user", lazy="selectin")
    # Don't define settings relationship here, it's defined in the SettingInstance model

    # Relationships that cause circular imports are now defined in app.models.relationships
    # pages = relationship("Page", back_populates="creator", lazy="selectin")
    # navigation_routes = relationship("NavigationRoute", back_populates="creator", lazy="selectin")
    # conversations = relationship("Conversation", back_populates="user", lazy="selectin")
    # tags = relationship("Tag", back_populates="user", lazy="selectin")

    @property
    def password(self) -> str:
        """Get the hashed password."""
        return self.hashed_password

    @password.setter
    def password(self, value: str) -> None:
        """Set the hashed password."""
        self.hashed_password = value

    @classmethod
    async def get_by_email(cls, db, email: str):
        """Get a user by their email address."""
        try:
            logger.info(f"Getting user by email: {email}")
            if isinstance(db, JSONStorage):
                return db.get("users", {"email": email})
            else:
                query = select(cls).where(cls.email == email)
                result = await db.execute(query)
                return result.scalars().first()
        except Exception as e:
            logger.error(f"Error getting user by email: {e}")
            return None

    @classmethod
    async def get_by_id(cls, db, user_id):
        """Get a user by their ID."""
        try:
            logger.info(f"Getting user by ID: {user_id}")

            if isinstance(db, JSONStorage):
                return db.get("users", {"id": str(user_id)})
            else:
                # Always convert user_id to string for database compatibility
                user_id_str = str(user_id)
                query = select(cls).where(cls.id == user_id_str)
                result = await db.execute(query)
                return result.scalars().first()
        except Exception as e:
            logger.error(f"Error getting user by ID: {e}")
            return None

    async def save(self, db):
        """Save or update the user."""
        try:
            if isinstance(db, JSONStorage):
                user_dict = {
                    "id": str(self.id),
                    "username": self.username,
                    "email": self.email,
                    "hashed_password": self.hashed_password,
                    "full_name": self.full_name,
                    "profile_picture": self.profile_picture,
                    "is_active": self.is_active,
                    "is_verified": self.is_verified,
                    "version": self.version,
                    "refresh_token": self.refresh_token,
                    "refresh_token_expires": (
                        self.refresh_token_expires.isoformat()
                        if self.refresh_token_expires
                        else None
                    ),
                    "created_at": (
                        self.created_at.isoformat()
                        if self.created_at
                        else datetime.utcnow().isoformat()
                    ),
                    "updated_at": datetime.utcnow().isoformat(),
                }
                return db.upsert("users", user_dict)
            else:
                db.add(self)
                await db.commit()
                await db.refresh(self)
                return self
        except Exception as e:
            logger.error(f"Error saving user: {e}")
            await db.rollback()
            raise
