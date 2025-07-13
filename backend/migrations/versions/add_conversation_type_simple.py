"""add conversation_type field

Revision ID: add_conversation_type_simple
Revises: c5130afa654b
Create Date: 2025-06-23 16:42:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'add_conversation_type_simple'
down_revision: Union[str, None] = 'c5130afa654b'
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
        
        # Add conversation_type column only if it doesn't exist
        if 'conversation_type' not in columns:
            with op.batch_alter_table('conversations', schema=None) as batch_op:
                batch_op.add_column(sa.Column('conversation_type', sa.String(length=100), nullable=True))

            # Update existing conversations to have default conversation_type
            op.execute("UPDATE conversations SET conversation_type = 'chat' WHERE conversation_type IS NULL")


def downgrade() -> None:
    """Downgrade with conditional operations to prevent conflicts."""
    
    # Get database connection and inspector
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    
    # Check if conversations table exists and has the column
    if 'conversations' in inspector.get_table_names():
        columns = [col['name'] for col in inspector.get_columns('conversations')]
        
        # Remove conversation_type column only if it exists
        if 'conversation_type' in columns:
            with op.batch_alter_table('conversations', schema=None) as batch_op:
                batch_op.drop_column('conversation_type')