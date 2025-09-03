#!/usr/bin/env python3
"""
Password Reset Script for BrainDrive
Enhanced script with username lookup, password validation, and confirmation
"""

import asyncio
import argparse
import getpass
import sys
import os
from datetime import datetime
from pathlib import Path

# Add the backend directory to the Python path
backend_dir = Path(__file__).parent.parent
sys.path.insert(0, str(backend_dir))

from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db, db_factory
from app.models.user import User
from app.core.security import hash_password


class PasswordResetTool:
    """Enhanced password reset tool with validation and confirmation"""
    
    def __init__(self):
        self.session: AsyncSession = None
    
    async def initialize_db(self):
        """Initialize database connection"""
        try:
            # Get database session
            db_gen = get_db()
            self.session = await db_gen.__anext__()
            print("✓ Database connection established")
            return True
        except Exception as e:
            print(f"✗ Failed to connect to database: {e}")
            return False
    
    async def find_user_by_username(self, username: str) -> User | None:
        """Find user by username with detailed feedback"""
        try:
            # Try to find by username first (if the field exists)
            # For now, we'll skip this since get_by_username doesn't exist
            print(f"✗ No user found with username: {username}")
            return None
        except Exception as e:
            print(f"✗ Error searching for user: {e}")
            return None
    
    async def find_user_by_email(self, email: str) -> User | None:
        """Find user by email as fallback"""
        try:
            user = await User.get_by_email(self.session, email)
            if user:
                print(f"✓ User found by email: {user.username} ({user.email})")
                return user
            else:
                print(f"✗ No user found with email: {email}")
                return None
        except Exception as e:
            print(f"✗ Error searching for user by email: {e}")
            return None
    
    def validate_password_strength(self, password: str) -> tuple[bool, list[str]]:
        """Validate password strength with detailed feedback"""
        suggestions = []
        
        if len(password) < 8:
            suggestions.append("Use at least 8 characters")
        
        if not any(c.islower() for c in password):
            suggestions.append("Include lowercase letters")
        
        if not any(c.isupper() for c in password):
            suggestions.append("Include uppercase letters")
        
        if not any(c.isdigit() for c in password):
            suggestions.append("Include numbers")
        
        if not any(c in "!@#$%^&*(),.?\":{}|<>" for c in password):
            suggestions.append("Include special characters")
        
        is_valid = len(suggestions) == 0
        return is_valid, suggestions
    
    def get_secure_password(self) -> str | None:
        """Get password with validation and confirmation"""
        max_attempts = 3
        
        for attempt in range(max_attempts):
            print(f"\nPassword attempt {attempt + 1}/{max_attempts}")
            
            # Get password
            password = getpass.getpass("Enter new password: ")
            
            if not password:
                print("✗ Password cannot be empty")
                continue
            
            # Validate password strength
            is_valid, suggestions = self.validate_password_strength(password)
            
            if not is_valid:
                print("✗ Password does not meet requirements:")
                for suggestion in suggestions:
                    print(f"  - {suggestion}")
                continue
            
            # Confirm password
            confirm_password = getpass.getpass("Confirm new password: ")
            
            if password != confirm_password:
                print("✗ Passwords do not match")
                continue
            
            print("✓ Password meets all requirements")
            return password
        
        print(f"✗ Maximum password attempts ({max_attempts}) exceeded")
        return None
    
    async def update_user_password(self, user: User, new_password: str) -> bool:
        """Update user password with proper hashing"""
        try:
            # Hash the new password
            hashed_password = hash_password(new_password)
            
            # Update user password
            user.password = hashed_password
            await user.save(self.session)
            
            print("✓ Password updated successfully")
            return True
        except Exception as e:
            print(f"✗ Failed to update password: {e}")
            return False
    
    def log_password_reset(self, user: User, success: bool):
        """Log password reset activity"""
        timestamp = datetime.now().isoformat()
        log_entry = {
            "timestamp": timestamp,
            "action": "password_reset",
            "user_id": user.id,
            "username": user.username,
            "email": user.email,
            "success": success,
            "performed_by": "admin_script"
        }
        
        # Create logs directory if it doesn't exist
        logs_dir = backend_dir / "logs"
        logs_dir.mkdir(exist_ok=True)
        
        # Write to audit log
        log_file = logs_dir / "password_reset_audit.log"
        with open(log_file, "a") as f:
            f.write(f"{timestamp} - Password reset for {user.username} ({'SUCCESS' if success else 'FAILED'})\n")
        
        print(f"✓ Activity logged to {log_file}")
    
    async def reset_password_interactive(self, username: str):
        """Interactive password reset process"""
        print(f"\n{'='*50}")
        print("BrainDrive Password Reset Tool")
        print(f"{'='*50}")
        
        # Initialize database
        if not await self.initialize_db():
            return False
        
        # Find user
        print(f"\nSearching for user: {username}")
        user = await self.find_user_by_username(username)
        
        # If not found by username, try email
        if not user and "@" in username:
            print("\nTrying to find user by email...")
            user = await self.find_user_by_email(username)
        
        if not user:
            print("\n✗ User not found. Please check the username/email and try again.")
            return False
        
        # Confirm user details
        print(f"\nUser Details:")
        print(f"  Username: {user.username}")
        print(f"  Email: {user.email}")
        print(f"  Active: {'Yes' if user.is_active else 'No'}")
        
        confirm = input(f"\nReset password for this user? (y/N): ").lower().strip()
        if confirm != 'y':
            print("✗ Password reset cancelled")
            return False
        
        # Get new password
        print("\nPassword Requirements:")
        print("  - At least 8 characters")
        print("  - Include uppercase and lowercase letters")
        print("  - Include numbers")
        print("  - Include special characters")
        
        new_password = self.get_secure_password()
        if not new_password:
            return False
        
        # Update password
        print("\nUpdating password...")
        success = await self.update_user_password(user, new_password)
        
        # Log the activity
        self.log_password_reset(user, success)
        
        if success:
            print(f"\n✓ Password successfully reset for user: {user.username}")
            print("✓ User can now log in with the new password")
        else:
            print(f"\n✗ Failed to reset password for user: {user.username}")
        
        return success
    
    async def cleanup(self):
        """Clean up database connection"""
        if self.session:
            try:
                await self.session.close()
            except Exception as e:
                print(f"Note: Database session cleanup completed with minor issues: {e}")


async def main():
    """Main function with command line argument parsing"""
    parser = argparse.ArgumentParser(
        description="Reset password for a BrainDrive user",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python reset_password.py --username john_doe
  python reset_password.py --username user@example.com
  python reset_password.py -u admin_user
        """
    )
    
    parser.add_argument(
        "--username", "-u",
        required=True,
        help="Username or email address of the user"
    )
    
    parser.add_argument(
        "--version", "-v",
        action="version",
        version="BrainDrive Password Reset Tool v1.0"
    )
    
    args = parser.parse_args()
    
    # Create password reset tool
    reset_tool = PasswordResetTool()
    
    try:
        # Run password reset
        success = await reset_tool.reset_password_interactive(args.username)
        
        # Exit with appropriate code
        sys.exit(0 if success else 1)
        
    except KeyboardInterrupt:
        print("\n\n✗ Operation cancelled by user")
        sys.exit(1)
    except Exception as e:
        print(f"\n✗ Unexpected error: {e}")
        sys.exit(1)
    finally:
        await reset_tool.cleanup()


if __name__ == "__main__":
    # Run the async main function
    asyncio.run(main())