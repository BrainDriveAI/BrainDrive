import uuid
import sqlalchemy as sa
from sqlalchemy import Column, String, Boolean, Integer, ForeignKey, Text, select
from sqlalchemy.orm import relationship, selectinload
from typing import List, Optional
from app.models.base import Base
from app.models.mixins import TimestampMixin

class NavigationRoute(Base, TimestampMixin):
    __tablename__ = "navigation_routes"

    id = Column(String(32), primary_key=True, default=lambda: str(uuid.uuid4()).replace('-', ''))
    name = Column(String(100), nullable=False)  # Display name in sidebar
    route = Column(String(255), nullable=False)  # Base route path
    icon = Column(String(50), nullable=True)  # Icon identifier
    description = Column(Text, nullable=True)
    order = Column(Integer, default=0)  # For ordering in the sidebar
    is_visible = Column(Boolean, default=True)  # Whether to show in sidebar
    creator_id = Column(String(32), ForeignKey("users.id"), nullable=False)
    
    # Define a composite unique constraint for route and creator_id
    __table_args__ = (
        sa.UniqueConstraint('route', 'creator_id', name='navigation_routes_route_creator_id_key'),
    )
    
    # New fields
    is_system_route = Column(Boolean, default=False)  # Flag for system routes that cannot be deleted
    default_component_id = Column(String(100), nullable=True)  # Reference to component_id in components table
    default_page_id = Column(String(32), ForeignKey("pages.id", ondelete="SET NULL"), nullable=True)  # For assigning a page as default
    can_change_default = Column(Boolean, default=False)  # Flag to indicate if default component/page can be changed
    
    # NEW HIERARCHICAL FIELDS
    parent_id = Column(String(32), ForeignKey("navigation_routes.id", ondelete="CASCADE"), nullable=True)
    display_order = Column(Integer, default=0)
    is_collapsible = Column(Boolean, default=True)
    is_expanded = Column(Boolean, default=True)
    
    # RELATIONSHIPS
    parent = relationship("NavigationRoute", remote_side=[id], back_populates="children")
    children = relationship(
        "NavigationRoute",
        back_populates="parent",
        cascade="all, delete-orphan",
        order_by="NavigationRoute.display_order"
    )
    
    # Relationships that cause circular imports are now defined in app.models.relationships
    # creator = relationship("User", back_populates="navigation_routes")
    # pages = relationship("Page", foreign_keys="Page.navigation_route_id", back_populates="navigation_route")
    # default_page = relationship("Page", foreign_keys=[default_page_id], backref="default_for_routes")
    
    @classmethod
    async def get_by_id(cls, db, route_id):
        """Get a navigation route by its ID."""
        try:
            # Ensure route_id is a string
            route_id_str = str(route_id)
            route_id_no_hyphens = route_id_str.replace('-', '')
            
            # First try with the original ID (which might have hyphens)
            print(f"Querying for navigation route with original ID: {route_id_str}")
            query = select(cls).where(cls.id == route_id_str)
            result = await db.execute(query)
            route = result.scalars().first()
            
            # If not found, try with the ID without hyphens
            if not route:
                print(f"Navigation route not found with original ID, trying without hyphens: {route_id_no_hyphens}")
                query = select(cls).where(cls.id == route_id_no_hyphens)
            result = await db.execute(query)
            route = result.scalars().first()
            print(f"Navigation route found: {route is not None}")
            if route:
                print(f"Navigation route details: id={route.id}, name={route.name}, creator_id={route.creator_id}")
            return route
        except Exception as e:
            print(f"Error getting navigation route by ID: {e}")
            return None
    
    @classmethod
    async def get_by_route(cls, db, route):
        """Get a navigation route by its route path."""
        try:
            query = select(cls).where(cls.route == route)
            result = await db.execute(query)
            return result.scalars().first()
        except Exception as e:
            print(f"Error getting navigation route by route: {e}")
            return None
    
    @classmethod
    async def get_by_creator(cls, db, creator_id):
        """Get all navigation routes created by a specific user."""
        try:
            # Ensure creator_id is a string
            creator_id_str = str(creator_id)
            
            query = select(cls).where(cls.creator_id == creator_id_str).order_by(cls.order)
            result = await db.execute(query)
            return result.scalars().all()
        except Exception as e:
            print(f"Error getting navigation routes by creator: {e}")
            return []
    
    @classmethod
    async def get_visible_routes(cls, db):
        """Get all visible navigation routes."""
        try:
            print("Fetching visible navigation routes")
            query = select(cls).where(cls.is_visible == True).order_by(cls.order)
            result = await db.execute(query)
            routes = result.scalars().all()
            
            print(f"Found {len(routes)} visible routes")
            
            # Ensure routes are properly loaded
            for route in routes:
                print(f"Route: {route.id}, {route.name}, {route.route}, creator: {route.creator_id}")
                if hasattr(route, 'creator_id') and route.creator_id is None:
                    print(f"Warning: Route {route.id} has no creator_id")
                    
            return routes
        except Exception as e:
            print(f"Error getting visible navigation routes: {e}")
            return []
    
    @classmethod
    async def get_visible_routes_by_user(cls, db, user_id):
        """Get visible navigation routes for a specific user."""
        try:
            # Ensure user_id is a string
            user_id_str = str(user_id)
            
            query = select(cls).where(
                sa.and_(
                    cls.is_visible == True,
                    cls.creator_id == user_id_str
                )
            ).order_by(cls.order)
            result = await db.execute(query)
            routes = result.scalars().all()
            
            print(f"Found {len(routes)} visible routes for user {user_id_str}")
            return routes
        except Exception as e:
            print(f"Error getting visible navigation routes by user: {e}")
            return []
    
    async def save(self, db):
        """Save or update the navigation route."""
        try:
            db.add(self)
            await db.commit()
            await db.refresh(self)
            return self
        except Exception as e:
            print(f"Error saving navigation route: {e}")
            await db.rollback()
            raise
    
    @classmethod
    async def get_tree_structure(cls, db, creator_id: str) -> List['NavigationRoute']:
        """Get navigation routes as a tree structure for a specific user"""
        try:
            creator_id_str = str(creator_id)
            
            # Get all visible routes for the user, including children
            query = select(cls).options(
                selectinload(cls.children)
            ).where(
                sa.and_(
                    cls.is_visible == True,
                    cls.creator_id == creator_id_str,
                    cls.parent_id == None  # Only root level routes
                )
            ).order_by(cls.display_order)
            
            result = await db.execute(query)
            root_routes = result.scalars().all()
            
            # Recursively load children
            for route in root_routes:
                await cls._load_children_recursive(db, route, creator_id_str)
            
            return root_routes
        except Exception as e:
            print(f"Error getting navigation tree: {e}")
            return []
    
    @classmethod
    async def _load_children_recursive(cls, db, parent_route: 'NavigationRoute', creator_id: str):
        """Recursively load children for a navigation route"""
        try:
            query = select(cls).where(
                sa.and_(
                    cls.parent_id == parent_route.id,
                    cls.creator_id == creator_id,
                    cls.is_visible == True
                )
            ).order_by(cls.display_order)
            
            result = await db.execute(query)
            children = result.scalars().all()
            
            parent_route.children = children
            
            # Recursively load grandchildren
            for child in children:
                await cls._load_children_recursive(db, child, creator_id)
                
        except Exception as e:
            print(f"Error loading children for route {parent_route.id}: {e}")
    
    @classmethod
    async def validate_hierarchy(cls, db, route_id: str, parent_id: Optional[str]) -> tuple[bool, str]:
        """Validate that adding parent_id won't create circular reference"""
        if not parent_id:
            return True, "No parent specified"
        
        if route_id == parent_id:
            return False, "Route cannot be its own parent"
        
        # Check for circular reference by traversing up the parent chain
        current_parent_id = parent_id
        visited = set()
        
        while current_parent_id:
            if current_parent_id in visited:
                return False, "Circular reference detected in parent chain"
            
            if current_parent_id == route_id:
                return False, "Circular reference: route would become ancestor of itself"
            
            visited.add(current_parent_id)
            
            # Get the parent of current_parent_id
            parent_route = await cls.get_by_id(db, current_parent_id)
            if not parent_route:
                break
            
            current_parent_id = parent_route.parent_id
        
        return True, "Hierarchy is valid"
    
    @classmethod
    async def get_max_display_order(cls, db, parent_id: Optional[str], creator_id: str) -> int:
        """Get the maximum display_order for routes under a specific parent"""
        try:
            query = select(sa.func.max(cls.display_order)).where(
                sa.and_(
                    cls.parent_id == parent_id,
                    cls.creator_id == creator_id
                )
            )
            result = await db.execute(query)
            max_order = result.scalar()
            return max_order if max_order is not None else -1
        except Exception as e:
            print(f"Error getting max display order: {e}")
            return -1
    
    async def move_to_parent(self, db, new_parent_id: Optional[str], new_display_order: Optional[int] = None):
        """Move this route to a new parent and/or position"""
        try:
            # Validate the move
            is_valid, message = await self.validate_hierarchy(db, self.id, new_parent_id)
            if not is_valid:
                raise ValueError(f"Invalid hierarchy move: {message}")
            
            # If no display_order specified, append to end
            if new_display_order is None:
                new_display_order = await self.get_max_display_order(db, new_parent_id, self.creator_id) + 1
            
            # Update the route
            self.parent_id = new_parent_id
            self.display_order = new_display_order
            
            await self.save(db)
            return self
        except Exception as e:
            print(f"Error moving route: {e}")
            raise
