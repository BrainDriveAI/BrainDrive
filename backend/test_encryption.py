#!/usr/bin/env python3
"""
Test script for the encryption system
"""
import os
import sys
import json
from pathlib import Path

# Add the backend directory to Python path
backend_dir = Path(__file__).parent
sys.path.insert(0, str(backend_dir))

def test_encryption():
    """Test the encryption system"""
    print("🧪 Testing BrainDrive Encryption System")
    print("=" * 50)
    
    # Set a test encryption key
    os.environ['ENCRYPTION_MASTER_KEY'] = 'test-key-for-encryption-testing-12345'
    
    try:
        from app.core.encryption import encryption_service
        from app.core.encryption_config import encryption_config
        
        # Test 1: Configuration
        print("\n1️⃣ Testing Configuration")
        encrypted_fields = encryption_config.get_encrypted_fields()
        print(f"Configured encrypted fields: {encrypted_fields}")
        
        should_encrypt = encryption_config.should_encrypt_field("settings_instances", "value")
        print(f"Should encrypt settings_instances.value: {should_encrypt}")
        
        # Test 2: Basic encryption/decryption
        print("\n2️⃣ Testing Basic Encryption/Decryption")
        
        test_data = {
            "servers": [
                {
                    "id": "server_123",
                    "serverName": "Test Server",
                    "serverAddress": "http://localhost:11434",
                    "apiKey": "secret-api-key-12345",
                    "connectionStatus": "idle"
                }
            ]
        }
        
        print(f"Original data: {json.dumps(test_data, indent=2)}")
        
        # Encrypt
        encrypted = encryption_service.encrypt_field("settings_instances", "value", test_data)
        print(f"Encrypted (first 50 chars): {encrypted[:50]}...")
        print(f"Encrypted length: {len(encrypted)} characters")
        
        # Decrypt
        decrypted = encryption_service.decrypt_field("settings_instances", "value", encrypted)
        print(f"Decrypted data: {json.dumps(decrypted, indent=2)}")
        
        # Verify
        if decrypted == test_data:
            print("✅ Encryption/Decryption successful!")
        else:
            print("❌ Encryption/Decryption failed!")
            return False
        
        # Test 3: Encrypted value detection
        print("\n3️⃣ Testing Encrypted Value Detection")
        
        is_encrypted = encryption_service.is_encrypted_value(encrypted)
        print(f"Encrypted value detected: {is_encrypted}")
        
        plain_text = '{"test": "data"}'
        is_plain = encryption_service.is_encrypted_value(plain_text)
        print(f"Plain text detected as encrypted: {is_plain}")
        
        if is_encrypted and not is_plain:
            print("✅ Encrypted value detection working!")
        else:
            print("❌ Encrypted value detection failed!")
            return False
        
        # Test 4: SQLAlchemy column type
        print("\n4️⃣ Testing SQLAlchemy Column Type")
        
        from app.core.encrypted_column import EncryptedJSON
        
        column_type = EncryptedJSON("settings_instances", "value")
        
        # Test bind param (encryption)
        encrypted_by_column = column_type.process_bind_param(test_data, None)
        print(f"Column encrypted (first 50 chars): {encrypted_by_column[:50]}...")
        
        # Test result value (decryption)
        decrypted_by_column = column_type.process_result_value(encrypted_by_column, None)
        print(f"Column decrypted: {json.dumps(decrypted_by_column, indent=2)}")
        
        if decrypted_by_column == test_data:
            print("✅ SQLAlchemy column type working!")
        else:
            print("❌ SQLAlchemy column type failed!")
            return False
        
        # Test 5: API Key extraction
        print("\n5️⃣ Testing API Key Extraction")
        
        if "apiKey" in json.dumps(decrypted):
            api_key = decrypted["servers"][0]["apiKey"]
            print(f"Extracted API key: {api_key}")
            
            if api_key == "secret-api-key-12345":
                print("✅ API key preserved correctly!")
            else:
                print("❌ API key corrupted!")
                return False
        
        print("\n🎉 All tests passed!")
        return True
        
    except Exception as e:
        print(f"\n❌ Test failed with error: {e}")
        import traceback
        traceback.print_exc()
        return False

def test_performance():
    """Test encryption performance"""
    print("\n⚡ Performance Test")
    print("=" * 30)
    
    import time
    from app.core.encryption import encryption_service
    
    # Create test data
    test_data = {
        "servers": [
            {
                "id": f"server_{i}",
                "serverName": f"Test Server {i}",
                "serverAddress": f"http://localhost:{11434 + i}",
                "apiKey": f"secret-api-key-{i}-{'x' * 50}",  # Longer key
                "connectionStatus": "idle"
            }
            for i in range(10)  # 10 servers
        ]
    }
    
    # Test encryption speed
    start_time = time.time()
    for i in range(100):
        encrypted = encryption_service.encrypt_field("settings_instances", "value", test_data)
    encrypt_time = time.time() - start_time
    
    # Test decryption speed
    start_time = time.time()
    for i in range(100):
        decrypted = encryption_service.decrypt_field("settings_instances", "value", encrypted)
    decrypt_time = time.time() - start_time
    
    print(f"Encryption: 100 operations in {encrypt_time:.3f}s ({encrypt_time*10:.1f}ms per operation)")
    print(f"Decryption: 100 operations in {decrypt_time:.3f}s ({decrypt_time*10:.1f}ms per operation)")
    print(f"Data size: {len(json.dumps(test_data))} bytes")
    print(f"Encrypted size: {len(encrypted)} bytes")

if __name__ == "__main__":
    success = test_encryption()
    
    if success:
        test_performance()
        print("\n✅ All tests completed successfully!")
        sys.exit(0)
    else:
        print("\n❌ Tests failed!")
        sys.exit(1)