"""
Base class for user initializers.

This module defines the base class that all user initializer plugins must inherit from.
"""

import abc
import logging
from typing import List, Dict, Any, Optional
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

class UserInitializerBase(abc.ABC):
    """
    Base class for user initializer plugins.
    
    All plugins that want to initialize data for new users must inherit from this class
    and implement the required methods.
    """
    
    # Class properties
    name: str = "base_initializer"
    description: str = "Base initializer class"
    priority: int = 100  # Higher priority initializers run first
    dependencies: List[str] = []  # List of initializer names this one depends on
    
    def __init__(self):
        """Initialize the initializer plugin."""
        self.logger = logging.getLogger(f"{__name__}.{self.name}")
    
    @abc.abstractmethod
    async def initialize(self, user_id: str, db: AsyncSession, **kwargs) -> bool:
        """
        Initialize data for a new user.
        
        Args:
            user_id: The ID of the newly registered user
            db: Database session
            **kwargs: Additional arguments
            
        Returns:
            bool: True if initialization was successful, False otherwise
        """
        pass
    
    async def cleanup(self, user_id: str, db: AsyncSession, **kwargs) -> bool:
        """
        Clean up any resources if initialization fails.
        
        This method is called if initialization fails and the system needs to
        roll back any changes made by this initializer.
        
        Args:
            user_id: The ID of the user
            db: Database session
            **kwargs: Additional arguments
            
        Returns:
            bool: True if cleanup was successful, False otherwise
        """
        # Default implementation does nothing
        return True
    
    @classmethod
    def get_template_path(cls, template_name: str) -> str:
        """
        Get the path to a template file.
        
        This method is provided for backward compatibility but is no longer
        required since we're using hardcoded data.
        
        Args:
            template_name: Name of the template file
            
        Returns:
            str: Path to the template file
        """
        return f"backend/data_export/{template_name}.json"
    
    @classmethod
    def load_template(cls, template_name: str) -> List[Dict[str, Any]]:
        """
        Load a template file.
        
        This method is provided for backward compatibility but is no longer
        required since we're using hardcoded data.
        
        Args:
            template_name: Name of the template file
            
        Returns:
            List[Dict[str, Any]]: Template data
        """
        import json
        
        try:
            with open(cls.get_template_path(template_name), 'r') as f:
                return json.load(f)
        except Exception as e:
            logger.warning(f"Error loading template {template_name}: {e}")
            logger.info("Using default hardcoded data instead")
            return []