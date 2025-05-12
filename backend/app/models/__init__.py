# Import base classes
from app.models.base import Base
from app.models.mixins import TimestampMixin

# Import all models first
from app.models.user import User
from app.models.page import Page
from app.models.navigation import NavigationRoute
from app.models.conversation import Conversation
from app.models.tag import Tag
from app.models.component import Component
from app.models.plugin import Plugin
from app.models.settings import SettingDefinition, SettingInstance
from app.models.message import Message
from app.models.role import Role
from app.models.tenant_models import (
    Tenant,
    UserRole,
    TenantUser,
    RolePermission,
    Session,
    OAuthAccount
)

# Import relationships module last to establish relationships
from app.models.relationships import *
