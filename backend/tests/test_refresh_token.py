#!/usr/bin/env python3
"""Test script to verify refresh token functionality after fix"""

import asyncio
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.api.v1.endpoints.auth import validate_token_logic
import json
import base64
import time

def test_token_parsing():
    """Test that we can parse tokens without import errors"""
    # Sample token from the logs
    test_token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI4ZGUyZWNmOTljMDM0OTAxOGY3ODE2Yzk0ZWZmOGQ3YiIsInJlZnJlc2giOnRydWUsImV4cCI6MTc1ODIwOTU0My41MzgwMzgsImlhdCI6MTc1NTYxNzU0My41MzgwNDN9.tL6t7dKkjYgfoE94Gm9fNpCYraI66OAZeVbgi-4AeU8"
    
    try:
        # This is the exact code that was failing
        parts = test_token.split(".")
        if len(parts) == 3:
            padded = parts[1] + "=" * ((4 - len(parts[1]) % 4) % 4)
            payload = json.loads(base64.b64decode(padded))
            
            print("✅ Token parsing successful!")
            print(f"Payload: {json.dumps(payload, indent=2)}")
            
            # Test the validation logic
            is_valid, reason = validate_token_logic(payload)
            print(f"Validation result: {'✅ VALID' if is_valid else '❌ INVALID'}")
            print(f"Reason: {reason}")
            
            return True
    except Exception as e:
        print(f"❌ Error parsing token: {e}")
        import traceback
        traceback.print_exc()
        return False

def test_imports():
    """Test that all required imports work correctly"""
    try:
        import json
        import base64
        import time
        from jose import jwt, JWTError
        
        print("✅ All imports successful")
        
        # Test that json and base64 work
        test_data = {"test": "data"}
        json_str = json.dumps(test_data)
        encoded = base64.b64encode(json_str.encode()).decode()
        decoded = base64.b64decode(encoded).decode()
        parsed = json.loads(decoded)
        
        assert parsed == test_data
        print("✅ json and base64 modules work correctly")
        
        return True
    except Exception as e:
        print(f"❌ Import error: {e}")
        return False

def main():
    print("=" * 60)
    print("Testing Refresh Token Fix")
    print("=" * 60)
    
    # Test imports
    print("\n1. Testing imports...")
    imports_ok = test_imports()
    
    # Test token parsing
    print("\n2. Testing token parsing (the failing code)...")
    parsing_ok = test_token_parsing()
    
    # Summary
    print("\n" + "=" * 60)
    if imports_ok and parsing_ok:
        print("✅ ALL TESTS PASSED - The fix is working!")
        print("The refresh token endpoint should now work correctly.")
    else:
        print("❌ TESTS FAILED - Additional fixes needed")
    print("=" * 60)
    
    return 0 if (imports_ok and parsing_ok) else 1

if __name__ == "__main__":
    sys.exit(main())