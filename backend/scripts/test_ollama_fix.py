#!/usr/bin/env python3
"""
Test script to verify the Ollama JSON parsing fix.
This script simulates the problematic scenario and tests our robust parsing solution.
"""

import asyncio
import sys
import os
from pathlib import Path

# Add the backend directory to the Python path
backend_dir = Path(__file__).parent.parent
sys.path.insert(0, str(backend_dir))

from app.utils.json_parsing import safe_encrypted_json_parse, validate_ollama_settings_format, create_default_ollama_settings


def test_json_parsing_scenarios():
    """Test various JSON parsing scenarios that could cause the original error"""
    
    print("🧪 Testing JSON Parsing Scenarios")
    print("=" * 50)
    
    # Test cases that simulate the problematic scenarios
    test_cases = [
        {
            "name": "Valid JSON",
            "value": '{"servers": [{"id": "test", "serverName": "Test", "serverAddress": "http://localhost:11434"}]}',
            "should_succeed": True
        },
        {
            "name": "Double-encoded JSON",
            "value": '"{\"servers\": [{\"id\": \"test\", \"serverName\": \"Test\", \"serverAddress\": \"http://10.0.2.149:11434\"}]}"',
            "should_succeed": True
        },
        {
            "name": "Malformed JSON (extra data)",
            "value": '{"servers": []}extra_data',
            "should_succeed": False
        },
        {
            "name": "Encrypted-looking data (simulated)",
            "value": "8+iLdcrXT1+9USrxmxwMro42mehbpbQawJgdgbFunm4yGJGFO5M7+fMRdAEOrxreQ4I6JF0K+5Lmk3EFDAVBniDhKuUIsGW0LlINl1Z0BeWH7J4Rw+smaYfs27Gj2UPZYk1EVxQQcyytcE0nfl1yztFuCy40AQcrXrA1O8Pf73AfTBpYfISMsMSb4tc2zUb/T/5if+uUjNhxxuX9ermRzEG3Y8PxmzUL24D1v7nDr+4n",
            "should_succeed": False,
            "expect_encryption_error": True
        },
        {
            "name": "Empty string",
            "value": "",
            "should_succeed": True
        },
        {
            "name": "Already parsed dict",
            "value": {"servers": [{"id": "test", "serverName": "Test", "serverAddress": "http://localhost:11434"}]},
            "should_succeed": True
        },
        {
            "name": "JSON with extra quotes",
            "value": '""{"servers": [{"id": "test"}]}""',
            "should_succeed": True
        }
    ]
    
    results = []
    
    for i, test_case in enumerate(test_cases, 1):
        print(f"\n🔍 Test {i}: {test_case['name']}")
        print(f"Input: {repr(test_case['value'])}")
        
        try:
            result = safe_encrypted_json_parse(
                test_case['value'],
                context=f"test_case_{i}",
                setting_id="test_setting",
                definition_id="ollama_servers_settings"
            )
            
            success = True
            error_msg = None
            print(f"✅ Parsing succeeded")
            print(f"Result type: {type(result)}")
            print(f"Result preview: {str(result)[:100]}...")
            
        except ValueError as e:
            success = False
            error_msg = str(e)
            if test_case.get('expect_encryption_error') and 'encrypt' in error_msg.lower():
                print(f"✅ Expected encryption error: {error_msg}")
                success = True  # This is expected
            else:
                print(f"❌ ValueError: {error_msg}")
                
        except Exception as e:
            success = False
            error_msg = str(e)
            print(f"❌ Unexpected error: {error_msg}")
        
        # Check if result matches expectation
        expected_success = test_case['should_succeed']
        if test_case.get('expect_encryption_error'):
            expected_success = True  # We expect it to handle the error gracefully
            
        test_passed = success == expected_success
        
        results.append({
            'name': test_case['name'],
            'passed': test_passed,
            'success': success,
            'expected': expected_success,
            'error': error_msg
        })
        
        if test_passed:
            print(f"🎉 Test PASSED")
        else:
            print(f"💥 Test FAILED (expected success: {expected_success}, got: {success})")
    
    return results


def test_ollama_validation():
    """Test Ollama settings validation"""
    
    print("\n\n🔧 Testing Ollama Settings Validation")
    print("=" * 50)
    
    test_cases = [
        {
            "name": "Valid Ollama settings",
            "data": {
                "servers": [
                    {
                        "id": "server1",
                        "serverName": "Local Ollama",
                        "serverAddress": "http://localhost:11434",
                        "apiKey": ""
                    }
                ]
            },
            "should_be_valid": True
        },
        {
            "name": "Missing servers key",
            "data": {
                "other_key": "value"
            },
            "should_be_valid": False
        },
        {
            "name": "Empty servers array",
            "data": {
                "servers": []
            },
            "should_be_valid": True
        },
        {
            "name": "Invalid server structure",
            "data": {
                "servers": [
                    {
                        "id": "server1"
                        # Missing required fields
                    }
                ]
            },
            "should_be_valid": False
        },
        {
            "name": "Non-dict data",
            "data": "not a dict",
            "should_be_valid": False
        }
    ]
    
    results = []
    
    for i, test_case in enumerate(test_cases, 1):
        print(f"\n🔍 Validation Test {i}: {test_case['name']}")
        
        is_valid = validate_ollama_settings_format(test_case['data'])
        expected = test_case['should_be_valid']
        passed = is_valid == expected
        
        results.append({
            'name': test_case['name'],
            'passed': passed,
            'valid': is_valid,
            'expected': expected
        })
        
        if passed:
            print(f"✅ Validation test PASSED (valid: {is_valid})")
        else:
            print(f"❌ Validation test FAILED (expected: {expected}, got: {is_valid})")
    
    return results


def test_default_settings():
    """Test default settings creation"""
    
    print("\n\n⚙️ Testing Default Settings Creation")
    print("=" * 50)
    
    default_settings = create_default_ollama_settings()
    
    print(f"Default settings: {default_settings}")
    
    # Validate the default settings
    is_valid = validate_ollama_settings_format(default_settings)
    
    if is_valid:
        print("✅ Default settings are valid")
        return True
    else:
        print("❌ Default settings are invalid")
        return False


def print_summary(parsing_results, validation_results, default_test_passed):
    """Print test summary"""
    
    print("\n\n📊 TEST SUMMARY")
    print("=" * 50)
    
    # Parsing tests
    parsing_passed = sum(1 for r in parsing_results if r['passed'])
    parsing_total = len(parsing_results)
    print(f"JSON Parsing Tests: {parsing_passed}/{parsing_total} passed")
    
    for result in parsing_results:
        status = "✅" if result['passed'] else "❌"
        print(f"  {status} {result['name']}")
    
    # Validation tests
    validation_passed = sum(1 for r in validation_results if r['passed'])
    validation_total = len(validation_results)
    print(f"\nValidation Tests: {validation_passed}/{validation_total} passed")
    
    for result in validation_results:
        status = "✅" if result['passed'] else "❌"
        print(f"  {status} {result['name']}")
    
    # Default settings test
    default_status = "✅" if default_test_passed else "❌"
    print(f"\nDefault Settings Test: {default_status}")
    
    # Overall result
    total_passed = parsing_passed + validation_passed + (1 if default_test_passed else 0)
    total_tests = parsing_total + validation_total + 1
    
    print(f"\n🎯 OVERALL RESULT: {total_passed}/{total_tests} tests passed")
    
    if total_passed == total_tests:
        print("🎉 ALL TESTS PASSED! The Ollama JSON parsing fix is working correctly.")
        return True
    else:
        print("💥 Some tests failed. Please review the implementation.")
        return False


def main():
    """Main test function"""
    
    print("🚀 Starting Ollama JSON Parsing Fix Tests")
    print("=" * 60)
    
    try:
        # Run all tests
        parsing_results = test_json_parsing_scenarios()
        validation_results = test_ollama_validation()
        default_test_passed = test_default_settings()
        
        # Print summary
        all_passed = print_summary(parsing_results, validation_results, default_test_passed)
        
        if all_passed:
            print("\n✅ The fix is ready for deployment!")
            return 0
        else:
            print("\n❌ The fix needs more work.")
            return 1
            
    except Exception as e:
        print(f"\n💥 Test execution failed: {e}")
        import traceback
        traceback.print_exc()
        return 1


if __name__ == "__main__":
    exit_code = main()
    sys.exit(exit_code)