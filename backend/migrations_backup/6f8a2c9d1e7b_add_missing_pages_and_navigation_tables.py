"""add_missing_pages_and_navigation_tables

Revision ID: 6f8a2c9d1e7b
Revises: 5e7b1db2eee3
Create Date: 2025-03-15 11:55:40.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import sqlite

# revision identifiers, used by Alembic.
revision: str = '6f8a2c9d1e7b'
down_revision: Union[str, None] = '5e7b1db2eee3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Check if navigation_routes table already exists
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    tables = inspector.get_table_names()
    
    if 'navigation_routes' not in tables:
        # Create navigation_routes table
        op.create_table('navigation_routes',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('name', sa.String(length=100), nullable=False),
        sa.Column('route', sa.String(length=255), nullable=False),
        sa.Column('icon', sa.String(length=50), nullable=True),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('order', sa.Integer(), nullable=True),
        sa.Column('is_visible', sa.Boolean(), nullable=True),
        sa.Column('creator_id', sa.String(), nullable=False),
        sa.Column('created_at', sa.DateTime(), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=True),
        sa.Column('updated_at', sa.DateTime(), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=True),
        sa.ForeignKeyConstraint(['creator_id'], ['users.id'], ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('route')
        )
    
    if 'pages' not in tables:
        # Create pages table
        op.create_table('pages',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('name', sa.String(length=100), nullable=False),
        sa.Column('route', sa.String(length=255), nullable=False),
        sa.Column('parent_route', sa.String(length=255), nullable=True),
        sa.Column('content', sqlite.JSON(), nullable=False),
        sa.Column('content_backup', sqlite.JSON(), nullable=True),
        sa.Column('backup_date', sa.DateTime(), nullable=True),
        sa.Column('creator_id', sa.String(), nullable=False),
        sa.Column('navigation_route_id', sa.String(), nullable=True),
        sa.Column('is_published', sa.Boolean(), nullable=True),
        sa.Column('publish_date', sa.DateTime(), nullable=True),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('icon', sa.String(length=50), nullable=True),
        sa.Column('created_at', sa.DateTime(), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=True),
        sa.Column('updated_at', sa.DateTime(), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=True),
        sa.ForeignKeyConstraint(['creator_id'], ['users.id'], ),
        sa.ForeignKeyConstraint(['navigation_route_id'], ['navigation_routes.id'], ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('route')
        )


def downgrade() -> None:
    op.drop_table('pages')
    op.drop_table('navigation_routes')
