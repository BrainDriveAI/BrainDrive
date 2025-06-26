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
    # Add page_id column to conversations table
    # Using batch_alter_table for SQLite compatibility
    with op.batch_alter_table('conversations', schema=None) as batch_op:
        batch_op.add_column(sa.Column('page_id', sa.String(length=32), nullable=True))
    
    # Add indexes for efficient querying (SQLite compatible)
    op.create_index('idx_conversations_page_id', 'conversations', ['page_id'], unique=False)
    op.create_index('idx_conversations_user_page', 'conversations', ['user_id', 'page_id'], unique=False)
    
    # Note: Existing conversations will have page_id = NULL (treated as global conversations)
    # New page-specific conversations will have specific page_id values


def downgrade() -> None:
    # Remove indexes first
    op.drop_index('idx_conversations_user_page', table_name='conversations')
    op.drop_index('idx_conversations_page_id', table_name='conversations')
    
    # Remove page_id column using batch_alter_table for SQLite compatibility
    with op.batch_alter_table('conversations', schema=None) as batch_op:
        batch_op.drop_column('page_id')