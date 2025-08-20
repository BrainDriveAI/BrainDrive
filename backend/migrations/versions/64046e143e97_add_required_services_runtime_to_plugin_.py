"""add required_services_runtime to plugin table

Revision ID: 64046e143e97
Revises: cb95bbe8b720
Create Date: 2025-08-19 21:31:08.236450

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '64046e143e97'
down_revision: Union[str, None] = 'cb95bbe8b720'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    columns = [col["name"] for col in inspector.get_columns("plugin")]

    # Only add column if it doesn't already exist
    if "required_services_runtime" not in columns:
        op.add_column(
            "plugin",
            sa.Column("required_services_runtime", sa.Text(), nullable=True)
        )

    # Create plugin_service_runtime table if it doesn't exist
    if "plugin_service_runtime" not in inspector.get_table_names():
        op.create_table(
            "plugin_service_runtime",
            sa.Column("id", sa.String(), primary_key=True),
            sa.Column("plugin_id", sa.String(), nullable=False),
            sa.Column("name", sa.String(), nullable=False),
            sa.Column("source_url", sa.String(), nullable=True),
            sa.Column("type", sa.String(), nullable=True),
            sa.Column("install_command", sa.Text(), nullable=True),
            sa.Column("start_command", sa.Text(), nullable=True),
            sa.Column("healthcheck_url", sa.String(), nullable=True),
            sa.Column("required_env_vars", sa.Text(), nullable=True),
            sa.Column("status", sa.String(), server_default="pending", nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=True),
            sa.Column("updated_at", sa.DateTime(), nullable=True),
            sa.Column("user_id", sa.String(), nullable=False),
            sa.ForeignKeyConstraint(["plugin_id"], ["plugin.id"], ondelete="CASCADE"),
        )


def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)

    if "plugin_service_runtime" in inspector.get_table_names():
        op.drop_table("plugin_service_runtime")

    columns = [col["name"] for col in inspector.get_columns("plugin")]
    if "required_services_runtime" in columns:
        op.drop_column("plugin", "required_services_runtime")
