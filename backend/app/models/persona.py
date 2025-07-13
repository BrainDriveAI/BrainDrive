import uuid
import logging
from sqlalchemy import Column, String, Boolean, Text, ForeignKey
from sqlalchemy.orm import relationship
from app.models.base import Base
from app.models.mixins import TimestampMixin

logger = logging.getLogger(__name__)


class Persona(Base, TimestampMixin):
    """SQLAlchemy model for user personas."""
    
    __tablename__ = "personas"

    id = Column(
        String(32), primary_key=True, default=lambda: str(uuid.uuid4()).replace("-", "")
    )
    name = Column(String(100), nullable=False)
    description = Column(Text)
    system_prompt = Column(Text, nullable=False)  # Core behavioral instruction
    
    # Model settings stored as JSON string (SQLite compatible)
    model_settings = Column(Text)  # JSON: temperature, top_p, frequency_penalty, etc.
    
    # Identity metadata
    avatar = Column(String(255))  # URL or icon identifier
    tags = Column(Text)  # JSON array of tags
    sample_greeting = Column(Text)  # Optional sample greeting message
    
    # User relationship
    user_id = Column(String(32), ForeignKey("users.id"), nullable=False)
    
    # Status
    is_active = Column(Boolean, default=True)

    # Relationships
    conversations = relationship("Conversation", back_populates="persona")  # NEW - conversations using this persona

    def __repr__(self):
        return f"<Persona(id={self.id}, name={self.name}, user_id={self.user_id})>"
