"""merge heads for hierarchical nav + plugin service runtime

Revision ID: c3edaf85d73f
Revises: 219da9748f46, 4f726504a718
Create Date: 2025-08-21 17:38:06.586550

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c3edaf85d73f'
down_revision: Union[str, None] = ('219da9748f46', '4f726504a718')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
