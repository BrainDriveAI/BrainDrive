"""merge heads

Revision ID: c7eed881f009
Revises: restore_settings_tables, add_page_id_to_conversations
Create Date: 2025-06-25 13:34:43.475716

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c7eed881f009'
down_revision: Union[str, None] = ('restore_settings_tables', 'add_page_id_to_conversations')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
