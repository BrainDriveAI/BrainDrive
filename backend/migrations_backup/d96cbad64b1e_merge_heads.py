"""merge_heads

Revision ID: d96cbad64b1e
Revises: 2f13980fc441
Create Date: 2025-04-03 08:34:18.641429

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd96cbad64b1e'
down_revision: Union[str, None] = '2f13980fc441'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
