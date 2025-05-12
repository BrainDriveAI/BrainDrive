import uuid
from datetime import datetime
from sqlalchemy import Column, String, ForeignKey, DateTime, select
# Remove PostgreSQL UUID import as we're standardizing on String
from sqlalchemy.orm import relationship
from app.models.base import Base
from app.models.mixins import TimestampMixin

class Tag(Base, TimestampMixin):
    __tablename__ = "tags"

    id = Column(String(32), primary_key=True, default=lambda: str(uuid.uuid4()).replace('-', ''))
    user_id = Column(String(32), ForeignKey("users.id"), nullable=False)
    name = Column(String(50), nullable=False)
    color = Column(String(7), nullable=True)  # Hex color code (e.g., #FF5733)

    # Relationships
    user = relationship("User", back_populates="tags")
    conversations = relationship("ConversationTag", back_populates="tag", cascade="all, delete-orphan")

    @classmethod
    async def get_by_id(cls, db, tag_id):
        """Get a tag by its ID."""
        query = select(cls).where(cls.id == tag_id)
        result = await db.execute(query)
        return result.scalars().first()

    @classmethod
    async def get_by_user_id(cls, db, user_id):
        """Get all tags for a specific user."""
        query = select(cls).where(cls.user_id == user_id)
        result = await db.execute(query)
        return result.scalars().all()


class ConversationTag(Base):
    __tablename__ = "conversation_tags"

    conversation_id = Column(String(32), ForeignKey("conversations.id", ondelete="CASCADE"), primary_key=True)
    tag_id = Column(String(32), ForeignKey("tags.id", ondelete="CASCADE"), primary_key=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    # Relationships
    conversation = relationship("Conversation", back_populates="tags")
    tag = relationship("Tag", back_populates="conversations")
