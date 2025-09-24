"""Add definition_id to plugin_service_runtime

Revision ID: fa1cc8d52824
Revises: 5d073fe444c9
Create Date: 2025-09-23 14:47:29.771249

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'fa1cc8d52824'
down_revision: Union[str, None] = '5d073fe444c9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('plugin_service_runtime', schema=None) as batch_op:
        batch_op.add_column(sa.Column('definition_id', sa.String(), nullable=True))
    # ### end Alembic commands ###


def downgrade() -> None:
    with op.batch_alter_table('plugin_service_runtime', schema=None) as batch_op:
        batch_op.drop_column('definition_id')
    # ### end Alembic commands ###
