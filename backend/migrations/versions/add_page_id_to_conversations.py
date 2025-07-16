"""add page_id to conversations

Revision ID: add_page_id_to_conversations
Revises: add_conversation_type_simple
Create Date: 2025-06-25 13:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'add_page_id_to_conversations'
down_revision: Union[str, None] = 'add_conversation_type_simple'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade with conditional operations to prevent conflicts."""
    
    # Get database connection and inspector
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    
    # Check if conversations table exists and get its columns
    if 'conversations' in inspector.get_table_names():
        columns = [col['name'] for col in inspector.get_columns('conversations')]
        indexes = [idx['name'] for idx in inspector.get_indexes('conversations')]
        
        # Add page_id column only if it doesn't exist
        if 'page_id' not in columns:
            with op.batch_alter_table('conversations', schema=None) as batch_op:
                batch_op.add_column(sa.Column('page_id', sa.String(length=32), nullable=True))
        
        # Add indexes only if they don't exist
        if 'idx_conversations_page_id' not in indexes:
            op.create_index('idx_conversations_page_id', 'conversations', ['page_id'], unique=False)
        if 'idx_conversations_user_page' not in indexes:
            op.create_index('idx_conversations_user_page', 'conversations', ['user_id', 'page_id'], unique=False)
    
    # Note: Existing conversations will have page_id = NULL (treated as global conversations)
    # New page-specific conversations will have specific page_id values


def downgrade() -> None:
    """Downgrade with conditional operations to prevent conflicts."""
    
    # Get database connection and inspector
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    
    # Check if conversations table exists
    if 'conversations' in inspector.get_table_names():
        indexes = [idx['name'] for idx in inspector.get_indexes('conversations')]
        columns = [col['name'] for col in inspector.get_columns('conversations')]
        
        # Remove indexes only if they exist
        if 'idx_conversations_user_page' in indexes:
            op.drop_index('idx_conversations_user_page', table_name='conversations')
        if 'idx_conversations_page_id' in indexes:
            op.drop_index('idx_conversations_page_id', table_name='conversations')
        
        # Remove page_id column only if it exists
        if 'page_id' in columns:
            with op.batch_alter_table('conversations', schema=None) as batch_op:
                batch_op.drop_column('page_id')