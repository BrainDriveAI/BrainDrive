"""add_persona_id_to_conversations

Revision ID: 49d16cc7f8f1
Revises: abb6734b0519
Create Date: 2025-07-11 14:09:55.182588

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '49d16cc7f8f1'
down_revision: Union[str, None] = 'abb6734b0519'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add persona_id column to conversations table with foreign key constraint."""
    # Add persona_id column to conversations table
    with op.batch_alter_table('conversations', schema=None) as batch_op:
        batch_op.add_column(sa.Column('persona_id', sa.String(32), nullable=True))
        
        # Add foreign key constraint with SET NULL on delete
        batch_op.create_foreign_key(
            'fk_conversations_persona_id',
            'personas', 
            ['persona_id'], 
            ['id'],
            ondelete='SET NULL'
        )
        
        # Add index for performance
        batch_op.create_index('ix_conversations_persona_id', ['persona_id'], unique=False)


def downgrade() -> None:
    """Remove persona_id column and related constraints from conversations table."""
    with op.batch_alter_table('conversations', schema=None) as batch_op:
        # Drop index
        batch_op.drop_index('ix_conversations_persona_id')
        
        # Drop foreign key constraint
        batch_op.drop_constraint('fk_conversations_persona_id', type_='foreignkey')
        
        # Drop column
        batch_op.drop_column('persona_id')
