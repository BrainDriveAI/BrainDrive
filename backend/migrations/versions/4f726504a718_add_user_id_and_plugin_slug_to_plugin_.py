"""add user_id and plugin_slug to plugin_service_runtime

Revision ID: 4f726504a718
Revises: 64046e143e97
Create Date: 2025-08-20 13:43:35.020370

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '4f726504a718'
down_revision: Union[str, None] = '64046e143e97'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    
    if "plugin_service_runtime" in inspector.get_table_names():
        columns = [col["name"] for col in inspector.get_columns("plugin_service_runtime")]
        
        # Add user_id column if missing
        if "user_id" not in columns:
            op.add_column(
                "plugin_service_runtime",
                sa.Column("user_id", sa.String(32), nullable=False, server_default="")
            )
            # Add foreign key constraint
            op.create_foreign_key(
                "fk_plugin_service_runtime_user_id",
                "plugin_service_runtime", 
                "users",
                ["user_id"], 
                ["id"]
            )
        
        # Add plugin_slug column if missing  
        if "plugin_slug" not in columns:
            op.add_column(
                "plugin_service_runtime", 
                sa.Column("plugin_slug", sa.String(), nullable=False, server_default="")
            )

def downgrade() -> None:
    op.drop_constraint("fk_plugin_service_runtime_user_id", "plugin_service_runtime", type_="foreignkey")
    op.drop_column("plugin_service_runtime", "user_id")
    op.drop_column("plugin_service_runtime", "plugin_slug")
