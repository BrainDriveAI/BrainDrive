#!/usr/bin/env python3
"""
Simple runner script for the settings encryption inspection utility.
This script can be run from the command line to diagnose the Ollama JSON parsing issue.
"""

import asyncio
import sys
from pathlib import Path

# Add the backend directory to the Python path
backend_dir = Path(__file__).parent.parent
sys.path.insert(0, str(backend_dir))

from inspect_settings_encryption import main

if __name__ == "__main__":
    print("🔍 Running Settings Encryption Inspection")
    print("This will help diagnose the Ollama JSON parsing error")
    print("-" * 50)
    
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n⏹️  Inspection cancelled by user")
    except Exception as e:
        print(f"\n❌ Inspection failed: {e}")
        sys.exit(1)