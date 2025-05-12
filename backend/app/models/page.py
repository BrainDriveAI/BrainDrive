import uuid
import sqlalchemy as sa
from datetime import datetime
from sqlalchemy import Column, String, Boolean, JSON, ForeignKey, DateTime, Text, select
# Remove PostgreSQL UUID import
from sqlalchemy.orm import relationship
from app.models.base import Base
from app.models.mixins import TimestampMixin

class Page(Base, TimestampMixin):
    __tablename__ = "pages"

    id = Column(String(32), primary_key=True, default=lambda: str(uuid.uuid4()).replace('-', ''))
    name = Column(String(100), nullable=False)
    route = Column(String(255), nullable=False)  # Full path including parent paths
    parent_route = Column(String(255), nullable=True)  # For nested routes
    parent_type = Column(String(50), nullable=True, default="page")  # Type of parent: 'page', 'dashboard', 'plugin-studio', 'settings'
    is_parent_page = Column(Boolean, default=False)  # Flag indicating if this page can have children
    
    # Define a composite unique constraint for route and creator_id
    __table_args__ = (
        sa.UniqueConstraint('route', 'creator_id', name='pages_route_creator_id_key'),
    )
    content = Column(JSON, nullable=False)  # The page content as JSON
    content_backup = Column(JSON, nullable=True)  # Backup of the page content
    backup_date = Column(DateTime(timezone=True), nullable=True)
    creator_id = Column(String(32), ForeignKey("users.id"), nullable=False)
    navigation_route_id = Column(String(32), ForeignKey("navigation_routes.id"), nullable=True)  # Link to navigation route
    is_published = Column(Boolean, default=False)
    publish_date = Column(DateTime(timezone=True), nullable=True)
    description = Column(Text, nullable=True)  # For SEO and navigation
    icon = Column(String(50), nullable=True)  # Icon identifier for the page
    
    # Relationships
    # Relationship to User is now defined in app.models.relationships
    # creator = relationship("User", back_populates="pages")
    navigation_route = relationship("NavigationRoute", foreign_keys=[navigation_route_id], back_populates="pages")
    
    @classmethod
    async def get_by_id(cls, db, page_id):
        """Get a page by its ID."""
        try:
            # Ensure page_id is a string
            page_id_str = str(page_id)
            page_id_no_hyphens = page_id_str.replace('-', '')
            
            # First try with the original ID (which might have hyphens)
            print(f"Querying for page with original ID: {page_id_str}")
            query = select(cls).where(cls.id == page_id_str)
            result = await db.execute(query)
            page = result.scalars().first()
            
            # If not found, try with the ID without hyphens
            if not page:
                print(f"Page not found with original ID, trying without hyphens: {page_id_no_hyphens}")
                query = select(cls).where(cls.id == page_id_no_hyphens)
            result = await db.execute(query)
            page = result.scalars().first()
            print(f"Page found: {page is not None}")
            return page
        except Exception as e:
            print(f"Error getting page by ID: {e}")
            return None
    
    @classmethod
    async def get_by_route(cls, db, route):
        """Get a page by its route."""
        try:
            query = select(cls).where(cls.route == route)
            result = await db.execute(query)
            return result.scalars().first()
        except Exception as e:
            print(f"Error getting page by route: {e}")
            return None
    
    @classmethod
    async def get_by_creator(cls, db, creator_id):
        """Get all pages created by a specific user."""
        try:
            # Ensure creator_id is a string
            creator_id_str = str(creator_id)
            
            query = select(cls).where(cls.creator_id == creator_id_str)
            result = await db.execute(query)
            return result.scalars().all()
        except Exception as e:
            print(f"Error getting pages by creator: {e}")
            return []
    
    @classmethod
    async def get_published_pages(cls, db):
        """Get all published pages."""
        try:
            query = select(cls).where(cls.is_published == True)
            result = await db.execute(query)
            return result.scalars().all()
        except Exception as e:
            print(f"Error getting published pages: {e}")
            return []
    
    @classmethod
    async def get_by_navigation_route(cls, db, navigation_route_id):
        """Get all pages for a specific navigation route."""
        try:
            # Ensure navigation_route_id is a string
            navigation_route_id_str = str(navigation_route_id)
            
            # Handle UUIDs with or without hyphens
            if '-' not in navigation_route_id_str and len(navigation_route_id_str) == 32:
                # Format the UUID with hyphens if it doesn't have them
                navigation_route_id_str = f"{navigation_route_id_str[0:8]}-{navigation_route_id_str[8:12]}-{navigation_route_id_str[12:16]}-{navigation_route_id_str[16:20]}-{navigation_route_id_str[20:32]}"
            
            print(f"Querying for pages with navigation_route_id: {navigation_route_id_str}")
            query = select(cls).where(cls.navigation_route_id == navigation_route_id_str)
            result = await db.execute(query)
            pages = result.scalars().all()
            print(f"Found {len(pages)} pages with navigation_route_id: {navigation_route_id_str}")
            return pages
        except Exception as e:
            print(f"Error getting pages by navigation route: {e}")
            return []
    
    async def save(self, db):
        """Save or update the page."""
        try:
            db.add(self)
            await db.commit()
            await db.refresh(self)
            return self
        except Exception as e:
            print(f"Error saving page: {e}")
            await db.rollback()
            raise
    
    async def create_backup(self):
        """Create a backup of the current page content."""
        self.content_backup = self.content
        self.backup_date = datetime.utcnow()
    
    async def publish(self):
        """Publish the page."""
        self.is_published = True
        self.publish_date = datetime.utcnow()
    
    async def unpublish(self):
        """Unpublish the page."""
        self.is_published = False
        
    @classmethod
    async def get_by_parent_type(cls, db, parent_type):
        """Get all pages with a specific parent type."""
        try:
            query = select(cls).where(cls.parent_type == parent_type)
            result = await db.execute(query)
            return result.scalars().all()
        except Exception as e:
            print(f"Error getting pages by parent type: {e}")
            return []
    
    @classmethod
    async def get_parent_pages(cls, db):
        """Get all pages that can have children."""
        try:
            query = select(cls).where(cls.is_parent_page == True)
            result = await db.execute(query)
            return result.scalars().all()
        except Exception as e:
            print(f"Error getting parent pages: {e}")
            return []
    
    @classmethod
    async def get_by_parent_type_and_creator(cls, db, parent_type, creator_id):
        """Get all pages with a specific parent type and creator."""
        try:
            # Ensure creator_id is a string
            creator_id_str = str(creator_id)
            
            query = select(cls).where(
                sa.and_(
                    cls.parent_type == parent_type,
                    cls.creator_id == creator_id_str
                )
            )
            result = await db.execute(query)
            pages = result.scalars().all()
            print(f"Found {len(pages)} pages with parent_type {parent_type} for user {creator_id_str}")
            return pages
        except Exception as e:
            print(f"Error getting pages by parent type and creator: {e}")
            return []
    
    @classmethod
    async def get_by_parent_route_and_creator(cls, db, parent_route, creator_id):
        """Get all pages with a specific parent route and creator."""
        try:
            # Ensure creator_id is a string
            creator_id_str = str(creator_id)
            
            query = select(cls).where(
                sa.and_(
                    cls.parent_route == parent_route,
                    cls.creator_id == creator_id_str
                )
            )
            result = await db.execute(query)
            pages = result.scalars().all()
            print(f"Found {len(pages)} pages with parent_route {parent_route} for user {creator_id_str}")
            return pages
        except Exception as e:
            print(f"Error getting pages by parent route and creator: {e}")
            return []
    
    @classmethod
    async def get_by_is_parent_and_creator(cls, db, is_parent_page, creator_id):
        """Get all pages with a specific is_parent_page value and creator."""
        try:
            # Ensure creator_id is a string
            creator_id_str = str(creator_id)
            
            query = select(cls).where(
                sa.and_(
                    cls.is_parent_page == is_parent_page,
                    cls.creator_id == creator_id_str
                )
            )
            result = await db.execute(query)
            pages = result.scalars().all()
            print(f"Found {len(pages)} pages with is_parent_page={is_parent_page} for user {creator_id_str}")
            return pages
        except Exception as e:
            print(f"Error getting pages by is_parent_page and creator: {e}")
            return []
    
    @classmethod
    async def get_by_navigation_route_and_creator(cls, db, navigation_route_id, creator_id):
        """Get all pages with a specific navigation route and creator."""
        try:
            # Ensure navigation_route_id is a string
            navigation_route_id_str = str(navigation_route_id)
            
            # Handle UUIDs with or without hyphens
            if '-' not in navigation_route_id_str and len(navigation_route_id_str) == 32:
                # Format the UUID with hyphens if it doesn't have them
                navigation_route_id_str = f"{navigation_route_id_str[0:8]}-{navigation_route_id_str[8:12]}-{navigation_route_id_str[12:16]}-{navigation_route_id_str[16:20]}-{navigation_route_id_str[20:32]}"
            
            # Ensure creator_id is a string
            creator_id_str = str(creator_id)
            
            query = select(cls).where(
                sa.and_(
                    cls.navigation_route_id == navigation_route_id_str,
                    cls.creator_id == creator_id_str
                )
            )
            result = await db.execute(query)
            pages = result.scalars().all()
            print(f"Found {len(pages)} pages with navigation_route_id {navigation_route_id_str} for user {creator_id_str}")
            return pages
        except Exception as e:
            print(f"Error getting pages by navigation route and creator: {e}")
            return []
    
    @classmethod
    async def get_published_pages_by_creator(cls, db, creator_id):
        """Get all published pages by a specific creator."""
        try:
            # Ensure creator_id is a string
            creator_id_str = str(creator_id)
            
            query = select(cls).where(
                sa.and_(
                    cls.is_published == True,
                    cls.creator_id == creator_id_str
                )
            )
            result = await db.execute(query)
            pages = result.scalars().all()
            print(f"Found {len(pages)} published pages for user {creator_id_str}")
            return pages
        except Exception as e:
            print(f"Error getting published pages by creator: {e}")
            return []
    
    async def generate_full_route(self, db):
        """Generate the full route path based on parent relationships."""
        # If no parent information is provided, just use the page name
        if not self.parent_route and not self.parent_type:
            return self.name
            
        # If parent_type is specified and it's not "page", use the parent_type as prefix
        if self.parent_type and self.parent_type != "page":
            # Core route parent
            return f"{self.parent_type}/{self.name}"
            
        # If parent_type is "page" but no parent_route is specified, just use the page name
        if self.parent_type == "page" and not self.parent_route:
            return self.name
            
        # If we have a parent_route, find the parent page
        if self.parent_route:
            parent = await self.get_by_route(db, self.parent_route)
            if not parent:
                raise ValueError(f"Parent route {self.parent_route} not found")
                
            return f"{parent.route}/{self.name}"
            
        # Default case - just use the page name
        return self.name
    
    @classmethod
    async def validate_route(cls, db, page_name, parent_route=None, parent_type=None, exclude_page_id=None):
        """Validate that a route is unique within its parent context."""
        # Generate the full route
        full_route = page_name
        
        if parent_type and parent_type != "page":
            full_route = f"{parent_type}/{page_name}"
        elif parent_route:
            parent = await cls.get_by_route(db, parent_route)
            if not parent:
                raise ValueError(f"Parent route {parent_route} not found")
            full_route = f"{parent_route}/{page_name}"
        
        # Check if the route already exists
        query = select(cls).where(cls.route == full_route)
        
        # Exclude the current page if updating
        if exclude_page_id:
            query = query.where(cls.id != exclude_page_id)
            
        result = await db.execute(query)
        existing_page = result.scalars().first()
        
        return existing_page is None, full_route
