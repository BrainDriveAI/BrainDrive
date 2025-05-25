"""add version field to users

Revision ID: 8f37e0df1aaa
Revises: 0a4f64f25f5c
Create Date: 2025-05-21
"""

from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "8f37e0df1aaa"
down_revision: Union[str, None] = "0a4f64f25f5c"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    import logging
    logger = logging.getLogger("alembic.migration")
    logger.info("Starting to add version field to users table")
    try:
        op.add_column(
            "users",
            sa.Column(
                "version", sa.String(length=20), server_default="0.0.0", nullable=True
            ),
        )
        logger.info("Successfully added version field to users table")
    except Exception as e:
        logger.error(f"Failed to add version field: {e}")
        raise


def downgrade() -> None:
    op.drop_column("users", "version")
