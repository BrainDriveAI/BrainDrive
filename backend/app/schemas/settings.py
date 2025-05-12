from typing import Optional, List, Any, Dict, Union
from pydantic import BaseModel, Field
from datetime import datetime
from app.models.settings import SettingScope

class SettingDefinitionBase(BaseModel):
    name: str
    description: Optional[str] = None
    category: str
    type: str = Field(..., description="One of: 'string', 'number', 'boolean', 'object', 'array'")
    default_value: Optional[Any] = None
    allowed_scopes: List[SettingScope]
    validation: Optional[Dict[str, Any]] = None
    is_multiple: bool = False
    tags: Optional[List[str]] = None

class SettingDefinitionCreate(SettingDefinitionBase):
    id: str

class SettingDefinitionResponse(SettingDefinitionBase):
    id: str
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True

class SettingDefinitionUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    category: Optional[str] = None
    type: Optional[str] = None
    default_value: Optional[Any] = None
    allowed_scopes: Optional[List[SettingScope]] = None
    validation: Optional[Dict[str, Any]] = None
    is_multiple: Optional[bool] = None
    tags: Optional[List[str]] = None

class SettingInstanceBase(BaseModel):
    definition_id: str
    name: str
    value: Any
    scope: Union[str, SettingScope]
    user_id: Optional[str] = None
    page_id: Optional[str] = None

class SettingInstanceCreate(SettingInstanceBase):
    id: Optional[str] = None
    action: Optional[str] = None

    class Config:
        # This allows the model to accept enum values as strings
        use_enum_values = False

    @property
    def context_valid(self) -> bool:
        """Validate that the context matches the scope."""
        # If this is a delete action, we don't need to validate the context
        if self.action == 'delete':
            return True
            
        # Convert string scope to enum if needed
        current_scope = self.scope
        if isinstance(current_scope, str):
            try:
                # Try to get the enum value directly first
                current_scope = SettingScope(current_scope)
            except ValueError:
                # Try case-insensitive matching
                for scope_enum in SettingScope:
                    if scope_enum.value.lower() == current_scope.lower():
                        current_scope = scope_enum
                        break
                else:
                    # No match found
                    return False
            
        # For USER and USER_PAGE scopes, we'll set the user_id automatically if not provided
        # So we don't need to validate it here
        if current_scope == SettingScope.USER:
            return True
            
        if current_scope == SettingScope.PAGE and not self.page_id:
            return False
            
        if current_scope == SettingScope.USER_PAGE:
            if not self.page_id:
                return False
            # We'll set the user_id automatically if not provided
            return True
            
        # For SYSTEM and TENANT scopes, no additional context is required
        return True

class SettingInstanceUpdate(BaseModel):
    name: Optional[str] = None
    value: Optional[Any] = None

class SettingInstanceResponse(SettingInstanceBase):
    id: str
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True
