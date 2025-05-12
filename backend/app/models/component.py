import uuid
import sqlalchemy as sa
from sqlalchemy import Column, String, Boolean, Text, select, ForeignKey
# Remove PostgreSQL UUID import as we're standardizing on String
from sqlalchemy.orm import relationship
from app.models.base import Base
from app.models.mixins import TimestampMixin

class Component(Base, TimestampMixin):
    __tablename__ = "components"

    id = Column(String(32), primary_key=True, default=lambda: str(uuid.uuid4()).replace('-', ''))
    name = Column(String(100), nullable=False)  # Display name
    component_id = Column(String(100), nullable=False)  # Identifier for the component (unique per user)
    description = Column(Text, nullable=True)
    icon = Column(String(50), nullable=True)  # Icon identifier
    is_system = Column(Boolean, default=False)  # Flag for system components
    
    # User relationship
    user_id = Column(String(32), ForeignKey("users.id", name="fk_components_user_id"), nullable=False)
    user = relationship("User", back_populates="components")
    
    # Define a composite unique constraint for component_id and user_id
    __table_args__ = (
        sa.UniqueConstraint('component_id', 'user_id', name='components_component_id_user_id_key'),
    )
    
    @classmethod
    async def get_by_component_id(cls, db, component_id):
        """Get a component by its component_id."""
        try:
            query = select(cls).where(cls.component_id == component_id)
            result = await db.execute(query)
            return result.scalars().first()
        except Exception as e:
            print(f"Error getting component by component_id: {e}")
            return None
    
    @classmethod
    async def get_all_components(cls, db):
        """Get all components."""
        try:
            query = select(cls)
            result = await db.execute(query)
            return result.scalars().all()
        except Exception as e:
            print(f"Error getting all components: {e}")
            return []
    
    @classmethod
    async def get_system_components(cls, db):
        """Get all system components."""
        try:
            query = select(cls).where(cls.is_system == True)
            result = await db.execute(query)
            return result.scalars().all()
        except Exception as e:
            print(f"Error getting system components: {e}")
            return []
    
    async def save(self, db):
        """Save or update the component."""
        try:
            db.add(self)
            await db.commit()
            await db.refresh(self)
            return self
        except Exception as e:
            print(f"Error saving component: {e}")
            await db.rollback()
            raise
