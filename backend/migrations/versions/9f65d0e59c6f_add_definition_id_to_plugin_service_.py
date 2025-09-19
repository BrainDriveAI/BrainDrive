"""Add definition_id to plugin_service_runtime

Revision ID: 9f65d0e59c6f
Revises: 5d073fe444c9
Create Date: 2025-09-19 23:05:32.233513

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '9f65d0e59c6f'
down_revision: Union[str, None] = '5d073fe444c9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('plugin_service_runtime',
    sa.Column('id', sa.String(), nullable=False),
    sa.Column('plugin_id', sa.String(), nullable=False),
    sa.Column('plugin_slug', sa.String(), nullable=False),
    sa.Column('name', sa.String(), nullable=False),
    sa.Column('source_url', sa.String(), nullable=True),
    sa.Column('type', sa.String(), nullable=True),
    sa.Column('install_command', sa.Text(), nullable=True),
    sa.Column('start_command', sa.Text(), nullable=True),
    sa.Column('healthcheck_url', sa.String(), nullable=True),
    sa.Column('definition_id', sa.String(), nullable=True),
    sa.Column('required_env_vars', sa.Text(), nullable=True),
    sa.Column('status', sa.String(), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=True),
    sa.Column('updated_at', sa.DateTime(), nullable=True),
    sa.Column('user_id', sa.String(length=32), nullable=False),
    sa.ForeignKeyConstraint(['plugin_id'], ['plugin.id'], ),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name='fk_plugin_service_runtime_user_id'),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('plugin_service_runtime', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_plugin_service_runtime_id'), ['id'], unique=False)
        batch_op.create_index(batch_op.f('ix_plugin_service_runtime_plugin_id'), ['plugin_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_plugin_service_runtime_plugin_slug'), ['plugin_slug'], unique=False)

    # ### end Alembic commands ###


def downgrade() -> None:
    with op.batch_alter_table('plugin_service_runtime', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_plugin_service_runtime_plugin_slug'))
        batch_op.drop_index(batch_op.f('ix_plugin_service_runtime_plugin_id'))
        batch_op.drop_index(batch_op.f('ix_plugin_service_runtime_id'))

    op.drop_table('plugin_service_runtime')
    # ### end Alembic commands ###
