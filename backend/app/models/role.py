import uuid
from sqlalchemy import Column, String, Boolean
# Remove PostgreSQL UUID import as we're standardizing on String
from app.models.base import Base

class Role(Base):
    id = Column(String(32), primary_key=True, default=lambda: str(uuid.uuid4()).replace('-', ''))
    role_name = Column(String(50), unique=True, nullable=False)
    is_global = Column(Boolean, default=False)
    description = Column(String(200), nullable=True)  # Adding a new description field
