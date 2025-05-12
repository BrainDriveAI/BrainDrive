"""sync_database_schema

Revision ID: 5e7b1db2eee3
Revises: a13d7873cd63
Create Date: 2025-03-15 11:55:12.630119

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import sqlite

# revision identifiers, used by Alembic.
revision: str = '5e7b1db2eee3'
down_revision: Union[str, None] = 'a13d7873cd63'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # This migration represents the current state of the database
    # No changes are needed as the database already has all the required tables
    pass


def downgrade() -> None:
    # This is a sync migration, downgrade is not supported
    pass
