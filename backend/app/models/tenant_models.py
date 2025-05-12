# app/models/tenant_models.py

import uuid
from sqlalchemy import Column, String, Boolean, DateTime, Text, ForeignKey, UniqueConstraint
# Remove PostgreSQL UUID import as we're standardizing on String
from sqlalchemy.orm import relationship
from app.models.base import Base
from app.models.mixins import TimestampMixin


### 🏢 Tenant Model (Merged from tenant.py)
class Tenant(Base, TimestampMixin):
    __tablename__ = "tenants"

    id = Column(String(32), primary_key=True, default=lambda: str(uuid.uuid4()).replace('-', ''))
    name = Column(String(100), unique=True, nullable=False)
    description = Column(Text)
    sso_domain = Column(String(100), unique=True)

    # Relationships
    tenant_users = relationship("TenantUser", back_populates="tenant", lazy="selectin")
    # settings = relationship("TenantSetting", back_populates="tenant")
    # billing = relationship("TenantBilling", back_populates="tenant", uselist=False)
    # invites = relationship("TenantInvite", back_populates="tenant")


### 🏅 User Role Model
class UserRole(Base):
    __tablename__ = "user_roles"

    id = Column(String(32), primary_key=True, default=lambda: str(uuid.uuid4()).replace('-', ''))
    role_name = Column(String(50), unique=True, nullable=False)
    description = Column(String)
    is_global = Column(Boolean, default=False)

    # Relationships
    permissions = relationship("RolePermission", back_populates="role", lazy="selectin")
    tenant_users = relationship("TenantUser", back_populates="role", lazy="selectin")


### 🏠 Tenant User Model
class TenantUser(Base):
    __tablename__ = "tenant_users"

    id = Column(String(32), primary_key=True, default=lambda: str(uuid.uuid4()).replace('-', ''))
    tenant_id = Column(String(32), ForeignKey("tenants.id", ondelete="CASCADE"))
    user_id = Column(String(32), ForeignKey("users.id", ondelete="CASCADE"))
    role_id = Column(String(32), ForeignKey("user_roles.id", ondelete="CASCADE"))
    is_owner = Column(Boolean, default=False)

    # Relationships (Fix Circular Import using string references)
    tenant = relationship("Tenant", back_populates="tenant_users", lazy="selectin")
    user = relationship("User", back_populates="tenant_users", lazy="selectin")
    role = relationship("UserRole", back_populates="tenant_users", lazy="selectin")

    __table_args__ = (UniqueConstraint("tenant_id", "user_id", name="uq_tenant_user"),)


### 🛡 Role Permission Model
class RolePermission(Base):
    __tablename__ = "role_permissions"

    id = Column(String(32), primary_key=True, default=lambda: str(uuid.uuid4()).replace('-', ''))
    role_id = Column(String(32), ForeignKey("user_roles.id", ondelete="CASCADE"))
    permission_name = Column(String(100), nullable=False)

    # Relationships
    role = relationship("UserRole", back_populates="permissions", lazy="selectin")

    __table_args__ = (UniqueConstraint("role_id", "permission_name", name="uq_role_permission"),)


### 🔐 Session Model
class Session(Base, TimestampMixin):
    __tablename__ = "sessions"

    id = Column(String(32), primary_key=True, default=lambda: str(uuid.uuid4()).replace('-', ''))
    user_id = Column(String(32), ForeignKey("users.id", ondelete="CASCADE"))
    session_token = Column(String, unique=True, nullable=False)
    active_tenant_id = Column(String(32), ForeignKey("tenants.id", ondelete="SET NULL"))
    expires_at = Column(DateTime(timezone=True), nullable=False)

    # Relationships
    user = relationship("User", back_populates="sessions", lazy="selectin")
    active_tenant = relationship("Tenant", lazy="selectin")


### 🌍 OAuth Accounts Model
class OAuthAccount(Base, TimestampMixin):
    __tablename__ = "oauth_accounts"

    id = Column(String(32), primary_key=True, default=lambda: str(uuid.uuid4()).replace('-', ''))
    user_id = Column(String(32), ForeignKey("users.id", ondelete="CASCADE"))
    provider = Column(String(50), nullable=False)
    provider_user_id = Column(String, unique=True, nullable=False)

    # Relationships
    user = relationship("User", back_populates="oauth_accounts", lazy="selectin")
