"""add_conversation_tagging_tables

Revision ID: 9a0b1c2d3e4f
Revises: 8a9b0c1d2e3f
Create Date: 2025-03-25 12:52:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = '9a0b1c2d3e4f'
down_revision = '8a9b0c1d2e3f'  # Previous migration is the conversation and message tables
branch_labels = None
depends_on = None


def upgrade():
    # Create tags table
    op.create_table(
        'tags',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('user_id', sa.String(), nullable=False),
        sa.Column('name', sa.String(50), nullable=False),
        sa.Column('color', sa.String(7), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True, server_default=sa.text('now()')),
        sa.Column('updated_at', sa.DateTime(), nullable=True, server_default=sa.text('now()')),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_tags_id'), 'tags', ['id'], unique=False)
    
    # Create conversation_tags join table
    op.create_table(
        'conversation_tags',
        sa.Column('conversation_id', sa.String(), nullable=False),
        sa.Column('tag_id', sa.String(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=True, server_default=sa.text('now()')),
        sa.ForeignKeyConstraint(['conversation_id'], ['conversations.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['tag_id'], ['tags.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('conversation_id', 'tag_id')
    )
    
    # Create indexes for better query performance
    op.create_index(
        'ix_conversation_tags_conversation_id', 
        'conversation_tags', 
        ['conversation_id'], 
        unique=False
    )
    op.create_index(
        'ix_conversation_tags_tag_id', 
        'conversation_tags', 
        ['tag_id'], 
        unique=False
    )


def downgrade():
    # Drop conversation_tags table
    op.drop_index('ix_conversation_tags_tag_id', table_name='conversation_tags')
    op.drop_index('ix_conversation_tags_conversation_id', table_name='conversation_tags')
    op.drop_table('conversation_tags')
    
    # Drop tags table
    op.drop_index(op.f('ix_tags_id'), table_name='tags')
    op.drop_table('tags')
