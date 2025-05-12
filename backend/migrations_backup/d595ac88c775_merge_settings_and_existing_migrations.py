"""merge settings and existing migrations

Revision ID: d595ac88c775
Revises: 4599871357d8, 5b69e9b2667d
Create Date: 2025-03-04 09:45:52.135542

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd595ac88c775'
down_revision: Union[str, None] = ('4599871357d8', '5b69e9b2667d')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
