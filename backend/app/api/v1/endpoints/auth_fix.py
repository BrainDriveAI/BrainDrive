"""
Authentication Fix Script
This script provides utilities to fix authentication token mismatches
"""

import asyncio
import sys
import os
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(__file__))))

from app.core.database import db_factory
from app.models.user import User
from sqlalchemy import select
import logging

logger = logging.getLogger(__name__)

async def clear_all_refresh_tokens():
    """Clear all refresh tokens from the database to force fresh login"""
    async with db_factory.session_factory() as session:
        # Get all users
        result = await session.execute(select(User))
        users = result.scalars().all()
        
        print(f"Found {len(users)} users in database")
        
        for user in users:
            if user.refresh_token:
                print(f"Clearing refresh token for user {user.email} (ID: {user.id})")
                user.refresh_token = None
                user.refresh_token_expires = None
                await user.save(session)
            else:
                print(f"User {user.email} (ID: {user.id}) has no refresh token")
        
        print("All refresh tokens cleared. Users will need to login again.")

async def show_user_tokens():
    """Show current refresh tokens for all users"""
    async with db_factory.session_factory() as session:
        result = await session.execute(select(User))
        users = result.scalars().all()
        
        print(f"Current user tokens:")
        for user in users:
            token_preview = user.refresh_token[:20] + "..." if user.refresh_token else "None"
            print(f"  User: {user.email} (ID: {user.id})")
            print(f"    Token: {token_preview}")
            print(f"    Expires: {user.refresh_token_expires}")
            print()

if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description='Fix authentication token issues')
    parser.add_argument('--clear', action='store_true', help='Clear all refresh tokens')
    parser.add_argument('--show', action='store_true', help='Show current tokens')
    
    args = parser.parse_args()
    
    if args.clear:
        asyncio.run(clear_all_refresh_tokens())
    elif args.show:
        asyncio.run(show_user_tokens())
    else:
        print("Use --clear to clear all tokens or --show to display current tokens")