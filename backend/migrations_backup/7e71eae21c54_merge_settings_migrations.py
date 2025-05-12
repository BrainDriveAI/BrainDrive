"""merge settings migrations

Revision ID: 7e71eae21c54
Revises: c4aebeac7e8d, d595ac88c775
Create Date: 2025-03-04 11:51:53.958930

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '7e71eae21c54'
down_revision: Union[str, None] = ('c4aebeac7e8d', 'd595ac88c775')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
