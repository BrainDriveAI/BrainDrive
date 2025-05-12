"""remove_route_segment_use_page_name

Revision ID: 235727458fb6
Revises: 7a9b2c8d3e4f
Create Date: 2025-03-18 13:07:52.275367

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '235727458fb6'
down_revision: Union[str, None] = '7a9b2c8d3e4f'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Check if the pages table exists
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    tables = inspector.get_table_names()

    if 'pages' in tables:
        # Simply drop the route_segment column
        op.drop_column('pages', 'route_segment')


def downgrade() -> None:
    # Check if the pages table exists
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    tables = inspector.get_table_names()

    if 'pages' in tables:
        # Add the route_segment column back
        op.add_column('pages', sa.Column('route_segment', sa.String(length=255), nullable=True))

        # Populate route_segment with the last segment of the route
        op.execute("""
        UPDATE pages
        SET route_segment = 
            CASE
                WHEN route LIKE '%/%' THEN substr(route, instr(route, '/')+1)
                ELSE route
            END
        """)
