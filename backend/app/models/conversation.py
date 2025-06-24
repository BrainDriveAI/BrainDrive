import uuid
from datetime import datetime
from sqlalchemy import Column, String, Text, ForeignKey, DateTime, select
from sqlalchemy.dialects.postgresql import JSON
# Remove PostgreSQL UUID import as we're standardizing on String
from sqlalchemy.orm import relationship
from app.models.base import Base
from app.models.mixins import TimestampMixin

class Conversation(Base, TimestampMixin):
    __tablename__ = "conversations"

    id = Column(String(32), primary_key=True, default=lambda: str(uuid.uuid4()).replace('-', ''))
    user_id = Column(String, ForeignKey("users.id"), nullable=False)
    title = Column(String)
    page_context = Column(String)  # e.g., 'home', 'editor', 'chatbot_lab'
    model = Column(String)  # Store which model was used
    server = Column(String)  # Store which server was used
    conversation_type = Column(String(100), nullable=True, default="chat")  # New field for categorization

    # Relationships
    user = relationship("User", back_populates="conversations")
    messages = relationship("Message", back_populates="conversation", cascade="all, delete-orphan")
    
    # Tags relationship
    tags = relationship("ConversationTag", back_populates="conversation", cascade="all, delete-orphan")
    
    async def add_tag(self, db, tag_id):
        """Add a tag to the conversation."""
        from app.models.tag import ConversationTag
        
        # Check if the tag already exists for this conversation
        query = select(ConversationTag).where(
            ConversationTag.conversation_id == self.id,
            ConversationTag.tag_id == tag_id
        )
        result = await db.execute(query)
        existing = result.scalars().first()
        
        if not existing:
            conversation_tag = ConversationTag(conversation_id=self.id, tag_id=tag_id)
            db.add(conversation_tag)
            await db.commit()
        
        return self

    async def remove_tag(self, db, tag_id):
        """Remove a tag from the conversation."""
        from app.models.tag import ConversationTag
        
        query = select(ConversationTag).where(
            ConversationTag.conversation_id == self.id,
            ConversationTag.tag_id == tag_id
        )
        result = await db.execute(query)
        existing = result.scalars().first()
        
        if existing:
            await db.delete(existing)
            await db.commit()
        
        return self

    async def get_tags(self, db):
        """Get all tags for this conversation."""
        from app.models.tag import Tag, ConversationTag
        
        query = select(Tag).join(
            ConversationTag, 
            ConversationTag.tag_id == Tag.id
        ).where(ConversationTag.conversation_id == self.id)
        
        result = await db.execute(query)
        return result.scalars().all()

    @classmethod
    async def get_by_id(cls, db, conversation_id):
        """Get a conversation by its ID."""
        # Try to find the conversation with the ID as provided
        query = select(cls).where(cls.id == conversation_id)
        result = await db.execute(query)
        conversation = result.scalars().first()
        
        if conversation:
            return conversation
            
        # If not found, try with dashes removed (for backward compatibility)
        formatted_id = str(conversation_id).replace('-', '')
        if formatted_id != conversation_id:
            query = select(cls).where(cls.id == formatted_id)
            result = await db.execute(query)
            return result.scalars().first()
            
        return None

    @classmethod
    async def get_by_user_id(cls, db, user_id, skip=0, limit=100):
        """Get all conversations for a specific user with pagination."""
        # Ensure user_id is formatted consistently (without dashes)
        formatted_user_id = str(user_id).replace('-', '')
        query = select(cls).where(cls.user_id == formatted_user_id).order_by(
            cls.updated_at.desc()
        ).offset(skip).limit(limit)
        result = await db.execute(query)
        return result.scalars().all()

    async def get_messages(self, db, skip=0, limit=100):
        """Get all messages for this conversation with pagination."""
        from app.models.message import Message
        query = select(Message).where(
            Message.conversation_id == self.id
        ).order_by(Message.created_at).offset(skip).limit(limit)
        result = await db.execute(query)
        return result.scalars().all()
