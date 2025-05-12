from typing import Optional
from pydantic import BaseModel, EmailStr, constr

class UserBase(BaseModel):
    """Base schema for user data that's common across requests"""
    username: constr(min_length=3, max_length=50)  # type: ignore
    email: EmailStr
    full_name: Optional[str] = None
    profile_picture: Optional[str] = None

class UserCreate(UserBase):
    """Schema for user creation requests"""
    password: constr(min_length=8)  # type: ignore

    class Config:
        json_schema_extra = {
            "example": {
                "username": "johndoe",
                "email": "john.doe@example.com",
                "password": "strongpassword123",
                "full_name": "John Doe",
                "profile_picture": None
            }
        }

class UserLogin(BaseModel):
    """Schema for user login requests"""
    email: EmailStr
    password: str

    class Config:
        json_schema_extra = {
            "example": {
                "email": "john.doe@example.com",
                "password": "strongpassword123"
            }
        }

class UserInDB(UserBase):
    """Schema for user data as stored in the database"""
    id: str
    is_active: bool = True
    is_verified: bool = False

    class Config:
        from_attributes = True

class UserResponse(BaseModel):
    """Schema for user data in responses"""
    id: str
    username: str
    email: str
    full_name: Optional[str] = None
    profile_picture: Optional[str] = None
    is_active: bool = True
    is_verified: bool = False

    class Config:
        from_attributes = True
        json_schema_extra = {
            "example": {
                "id": "123e4567-e89b-12d3-a456-426614174000",
                "username": "johndoe",
                "email": "john.doe@example.com",
                "full_name": "John Doe",
                "profile_picture": None,
                "is_active": True,
                "is_verified": False
            }
        }
