"""
Utility functions for user initializers.

This module provides utility functions that can be used by initializer plugins.
"""

import os
import json
import logging
import uuid
import datetime
from typing import Dict, Any, List, Optional, TypeVar, Type, Union
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import DeclarativeBase

logger = logging.getLogger(__name__)

T = TypeVar('T', bound=DeclarativeBase)

def generate_uuid() -> str:
    """
    Generate a new UUID string without dashes.
    
    Returns:
        str: UUID string with dashes removed
    """
    return str(uuid.uuid4()).replace('-', '')

def get_current_timestamp() -> str:
    """
    Get the current timestamp in the format used by the database.
    
    Returns:
        str: Current timestamp in format 'YYYY-MM-DD HH:MM:SS'
    """
    return datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")

def prepare_record_for_new_user(
    record: Dict[str, Any],
    user_id: str,
    preserve_fields: List[str] = None,
    user_id_field: str = None
) -> Dict[str, Any]:
    """
    Prepare a record for a new user by:
    1. Generating a new ID
    2. Setting the user_id/creator_id field
    3. Setting created_at and updated_at to current time
    
    Args:
        record: The original record data
        user_id: The ID of the new user
        preserve_fields: List of fields to preserve from the original record
        user_id_field: The name of the field to use for the user ID (default: auto-detect)
        
    Returns:
        Dict[str, Any]: The prepared record
    """
    # Create a copy of the record
    new_record = record.copy()
    
    # Fields to preserve (don't modify)
    preserve = preserve_fields or []
    
    # Generate a new ID if not in preserve list
    if "id" not in preserve:
        new_record["id"] = generate_uuid()
    
    # Set user_id or creator_id based on the model
    if user_id_field:
        # Use the specified field
        if user_id_field not in preserve:
            new_record[user_id_field] = user_id
    else:
        # Auto-detect the field
        if "user_id" in new_record and "user_id" not in preserve:
            new_record["user_id"] = user_id
        if "creator_id" in new_record and "creator_id" not in preserve:
            new_record["creator_id"] = user_id
    
    # Set timestamps
    current_time = get_current_timestamp()
    if "created_at" in new_record and "created_at" not in preserve:
        new_record["created_at"] = current_time
    if "updated_at" in new_record and "updated_at" not in preserve:
        new_record["updated_at"] = current_time
    
    return new_record

async def get_entity_by_id(db: AsyncSession, model_class: Type[T], entity_id: str) -> Optional[T]:
    """
    Get an entity by its ID.
    
    Args:
        db: Database session
        model_class: The model class
        entity_id: The entity ID
        
    Returns:
        Optional[T]: The entity if found, None otherwise
    """
    try:
        result = await db.execute(
            select(model_class).where(model_class.id == entity_id)
        )
        return result.scalar_one_or_none()
    except Exception as e:
        logger.error(f"Error getting {model_class.__name__} by ID {entity_id}: {e}")
        return None

async def get_entities_by_field(
    db: AsyncSession, 
    model_class: Type[T], 
    field_name: str, 
    field_value: Any
) -> List[T]:
    """
    Get entities by a field value.
    
    Args:
        db: Database session
        model_class: The model class
        field_name: The field name
        field_value: The field value
        
    Returns:
        List[T]: List of entities matching the criteria
    """
    try:
        result = await db.execute(
            select(model_class).where(getattr(model_class, field_name) == field_value)
        )
        return result.scalars().all()
    except Exception as e:
        logger.error(f"Error getting {model_class.__name__} by {field_name}={field_value}: {e}")
        return []

def load_json_file(file_path: str) -> Any:
    """
    Load a JSON file.
    
    Args:
        file_path: Path to the JSON file
        
    Returns:
        Any: The loaded JSON data
    """
    try:
        if not os.path.exists(file_path):
            logger.error(f"File not found: {file_path}")
            return None
            
        with open(file_path, 'r') as f:
            return json.load(f)
    except Exception as e:
        logger.error(f"Error loading JSON file {file_path}: {e}")
        return None

def save_json_file(file_path: str, data: Any) -> bool:
    """
    Save data to a JSON file.
    
    Args:
        file_path: Path to the JSON file
        data: Data to save
        
    Returns:
        bool: True if successful, False otherwise
    """
    try:
        # Create directory if it doesn't exist
        os.makedirs(os.path.dirname(file_path), exist_ok=True)
        
        with open(file_path, 'w') as f:
            json.dump(data, f, indent=2, default=str)
        return True
    except Exception as e:
        logger.error(f"Error saving JSON file {file_path}: {e}")
        return False

def replace_ids_in_data(data: Dict[str, Any], id_map: Dict[str, str]) -> Dict[str, Any]:
    """
    Replace IDs in data using a mapping.
    
    Args:
        data: The data to process
        id_map: Mapping of old IDs to new IDs
        
    Returns:
        Dict[str, Any]: The processed data
    """
    if not isinstance(data, dict):
        return data
        
    result = {}
    for key, value in data.items():
        if key == "id" and value in id_map:
            result[key] = id_map[value]
        elif isinstance(value, dict):
            result[key] = replace_ids_in_data(value, id_map)
        elif isinstance(value, list):
            result[key] = [
                replace_ids_in_data(item, id_map) if isinstance(item, dict) else item
                for item in value
            ]
        else:
            result[key] = value
    
    return result