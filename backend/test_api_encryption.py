#!/usr/bin/env python3
"""
Test script to verify API encryption is working
"""
import os
import sys
import json
import asyncio
from pathlib import Path

# Add the backend directory to Python path
backend_dir = Path(__file__).parent
sys.path.insert(0, str(backend_dir))

# Load environment variables
from dotenv import load_dotenv
load_dotenv()

async def test_api_encryption():
    """Test that the API properly encrypts settings"""
    print("🧪 Testing API Encryption Integration")
    print("=" * 50)
    
    try:
        from app.core.database import get_db
        from app.models.settings import SettingInstance
        from app.core.encryption import encryption_service
        from sqlalchemy import text
        
        # Test data similar to what ComponentOllamaServer.tsx sends
        test_settings = {
            "servers": [
                {
                    "id": "test_server_123",
                    "serverName": "Test API Server",
                    "serverAddress": "http://localhost:11434",
                    "apiKey": "test-api-key-should-be-encrypted",
                    "connectionStatus": "idle"
                }
            ]
        }
        
        print("1️⃣ Creating setting instance using SQLAlchemy model...")
        print(f"Original data: {json.dumps(test_settings, indent=2)}")
        
        # Get database session
        async for db in get_db():
            # Create instance using SQLAlchemy model (like the fixed API does)
            new_instance = SettingInstance(
                id="test_api_encryption_123",
                definition_id="ollama_servers_settings",
                name="Test API Encryption",
                value=test_settings,  # This should be encrypted automatically
                scope="user",
                user_id="test_user_123"
            )
            
            # Add and commit
            db.add(new_instance)
            await db.commit()
            await db.refresh(new_instance)
            
            print(f"✅ Created instance with ID: {new_instance.id}")
            
            # Check what's actually stored in the database (raw encrypted data)
            raw_query = text("SELECT value FROM settings_instances WHERE id = :id")
            result = await db.execute(raw_query, {"id": "test_api_encryption_123"})
            raw_value = result.scalar()
            
            print(f"\n2️⃣ Raw value in database:")
            print(f"Length: {len(raw_value)} characters")
            print(f"First 100 chars: {raw_value[:100]}...")
            
            # Check if it's encrypted
            is_encrypted = encryption_service.is_encrypted_value(raw_value)
            print(f"Is encrypted: {is_encrypted}")
            
            # Retrieve using SQLAlchemy (should decrypt automatically)
            retrieved_instance = await db.get(SettingInstance, "test_api_encryption_123")
            
            print(f"\n3️⃣ Retrieved and decrypted data:")
            print(json.dumps(retrieved_instance.value, indent=2))
            
            # Verify API key is preserved
            original_api_key = test_settings["servers"][0]["apiKey"]
            retrieved_api_key = retrieved_instance.value["servers"][0]["apiKey"]
            
            print(f"\n4️⃣ API Key Verification:")
            print(f"Original: {original_api_key}")
            print(f"Retrieved: {retrieved_api_key}")
            
            if original_api_key == retrieved_api_key and is_encrypted:
                print("✅ API encryption working correctly!")
                success = True
            else:
                print("❌ API encryption failed!")
                success = False
            
            # Clean up
            await db.delete(retrieved_instance)
            await db.commit()
            
            break  # Exit the async generator
        
        return success
        
    except Exception as e:
        print(f"\n❌ Test failed: {e}")
        import traceback
        traceback.print_exc()
        return False

if __name__ == "__main__":
    success = asyncio.run(test_api_encryption())
    if success:
        print(f"\n🎉 API encryption test passed!")
        print(f"The settings API will now automatically encrypt API keys!")
    else:
        print(f"\n❌ API encryption test failed!")
        sys.exit(1)