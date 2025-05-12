import uuid
import json
from datetime import datetime
from sqlalchemy import Column, String, Text, ForeignKey, DateTime, select
# Remove PostgreSQL UUID import as we're standardizing on String
from sqlalchemy.types import TypeDecorator, TEXT
from sqlalchemy.orm import relationship
from app.models.base import Base
from app.models.mixins import TimestampMixin
from app.core.config import settings

# Create a custom JSON type that works with both SQLite and PostgreSQL
class JSONType(TypeDecorator):
    impl = TEXT
    cache_ok = True

    def process_bind_param(self, value, dialect):
        if value is not None:
            value = json.dumps(value)
        return value

    def process_result_value(self, value, dialect):
        if value is not None:
            value = json.loads(value)
        return value

class Message(Base, TimestampMixin):
    __tablename__ = "messages"

    id = Column(String(32), primary_key=True, default=lambda: str(uuid.uuid4()).replace('-', ''))
    conversation_id = Column(String(32), ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False)
    sender = Column(String, nullable=False)  # 'user' or 'llm'
    message = Column(Text, nullable=False)
    message_metadata = Column(JSONType, nullable=True)  # JSON field for evolving message data
    # Example message_metadata:
    # {
    #     "token_count": 153,
    #     "tokens_per_second": 12.7,
    #     "model": "llama3-8b",
    #     "temperature": 0.8
    # }

    # Relationships
    conversation = relationship("Conversation", back_populates="messages")

    @classmethod
    async def get_by_id(cls, db, message_id):
        """Get a message by its ID."""
        # Ensure ID is formatted consistently (without dashes)
        formatted_id = str(message_id).replace('-', '')
        query = select(cls).where(cls.id == formatted_id)
        result = await db.execute(query)
        return result.scalars().first()

    @classmethod
    async def get_by_conversation_id(cls, db, conversation_id, skip=0, limit=100):
        """Get all messages for a specific conversation with pagination."""
        # Try to find messages with the conversation_id as provided
        query = select(cls).where(cls.conversation_id == conversation_id).order_by(
            cls.created_at
        ).offset(skip).limit(limit)
        result = await db.execute(query)
        messages = result.scalars().all()
        
        if messages:
            return messages
            
        # If no messages found, try with dashes removed (for backward compatibility)
        formatted_conversation_id = str(conversation_id).replace('-', '')
        if formatted_conversation_id != conversation_id:
            query = select(cls).where(cls.conversation_id == formatted_conversation_id).order_by(
                cls.created_at
            ).offset(skip).limit(limit)
            result = await db.execute(query)
            return result.scalars().all()
            
        return []
