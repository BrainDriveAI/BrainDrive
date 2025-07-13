"""merge personas with existing heads

Revision ID: abb6734b0519
Revises: c7eed881f009, a1b2c3d4e5f7
Create Date: 2025-07-10 08:40:10.026135

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'abb6734b0519'
down_revision: Union[str, None] = ('c7eed881f009', 'a1b2c3d4e5f7')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
