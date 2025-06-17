#!/usr/bin/env python3
"""
Test script to verify improved error reporting in remote plugin installation
"""

import asyncio
import sys
import os
from pathlib import Path

# Add the backend directory to the Python path
backend_dir = Path(__file__).parent / "backend"
sys.path.insert(0, str(backend_dir))

from app.plugins.remote_installer import RemotePluginInstaller

async def test_error_scenarios():
    """Test various error scenarios to verify improved error reporting"""

    installer = RemotePluginInstaller()

    print("🧪 Testing Remote Plugin Installer Error Reporting\n")

    # Test 1: Invalid URL
    print("1️⃣ Testing invalid repository URL...")
    result = await installer.install_from_url("invalid-url", "test_user", "latest")
    print(f"   Result: {result}")
    print(f"   Details: {result.get('details', {})}")
    print()

    # Test 2: Non-existent repository
    print("2️⃣ Testing non-existent repository...")
    result = await installer.install_from_url("https://github.com/nonexistent/repo", "test_user", "latest")
    print(f"   Result: {result}")
    print(f"   Details: {result.get('details', {})}")
    print()

    # Test 3: Repository with no releases
    print("3️⃣ Testing repository with no releases...")
    result = await installer.install_from_url("https://github.com/octocat/Hello-World", "test_user", "latest")
    print(f"   Result: {result}")
    print(f"   Details: {result.get('details', {})}")
    print()

    # Test 4: Specific version that doesn't exist
    print("4️⃣ Testing non-existent version...")
    result = await installer.install_from_url("https://github.com/BrainDriveAI/NetworkEyes", "test_user", "v999.999.999")
    print(f"   Result: {result}")
    print(f"   Details: {result.get('details', {})}")
    print()

    print("✅ Error reporting tests completed!")

if __name__ == "__main__":
    asyncio.run(test_error_scenarios())