"""add personas table

Revision ID: a1b2c3d4e5f7
Revises: 8f37e0df1aaa
Create Date: 2025-01-10
"""

from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "a1b2c3d4e5f7"
down_revision: Union[str, None] = "8f37e0df1aaa"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    import logging
    logger = logging.getLogger("alembic.migration")
    logger.info("Starting to create personas table")
    try:
        # Create personas table
        op.create_table(
            'personas',
            sa.Column('id', sa.String(32), primary_key=True, index=True),
            sa.Column('name', sa.String(100), nullable=False),
            sa.Column('description', sa.Text(), nullable=True),
            sa.Column('system_prompt', sa.Text(), nullable=False),
            sa.Column('model_settings', sa.Text(), nullable=True),
            sa.Column('avatar', sa.String(255), nullable=True),
            sa.Column('tags', sa.Text(), nullable=True),
            sa.Column('sample_greeting', sa.Text(), nullable=True),
            sa.Column('user_id', sa.String(32), nullable=False),
            sa.Column('is_active', sa.Boolean(), server_default='1', nullable=True),
            sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=True),
            sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=True),
            sa.ForeignKeyConstraint(['user_id'], ['users.id'], name='fk_persona_user_id'),
        )
        logger.info("Successfully created personas table")
    except Exception as e:
        logger.error(f"Failed to create personas table: {e}")
        raise


def downgrade() -> None:
    import logging
    logger = logging.getLogger("alembic.migration")
    logger.info("Starting to drop personas table")
    try:
        op.drop_table('personas')
        logger.info("Successfully dropped personas table")
    except Exception as e:
        logger.error(f"Failed to drop personas table: {e}")
        raise
