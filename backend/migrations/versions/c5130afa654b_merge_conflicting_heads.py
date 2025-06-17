"""Merge conflicting heads

Revision ID: c5130afa654b
Revises: 8f37e0df1aaa, add_plugin_update_fields
Create Date: 2025-05-29 13:06:40.023826

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c5130afa654b'
down_revision: Union[str, None] = ('8f37e0df1aaa', 'add_plugin_update_fields')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
