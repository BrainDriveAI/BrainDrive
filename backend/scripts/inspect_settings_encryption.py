#!/usr/bin/env python3
"""
Database inspection utility for encrypted settings values.
This script helps diagnose JSON parsing issues in the Ollama provider settings.
"""

import asyncio
import json
import sys
import os
from pathlib import Path
from typing import Any, Dict, List, Optional

# Add the backend directory to the Python path
backend_dir = Path(__file__).parent.parent
sys.path.insert(0, str(backend_dir))

from sqlalchemy import create_engine, text
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker

from app.core.config import settings
from app.core.database import get_db
from app.models.settings import SettingInstance
from app.core.encryption import encryption_service


class SettingsInspector:
    """Inspector for encrypted settings values in the database"""
    
    def __init__(self, database_url: str = None):
        self.database_url = database_url or settings.DATABASE_URL
        self.engine = None
        self.async_session = None
        
    async def initialize(self):
        """Initialize database connection"""
        if self.database_url.startswith('sqlite'):
            # Convert to async SQLite URL
            async_url = self.database_url.replace('sqlite:///', 'sqlite+aiosqlite:///')
        else:
            async_url = self.database_url
            
        self.engine = create_async_engine(async_url, echo=False)
        self.async_session = sessionmaker(
            self.engine, class_=AsyncSession, expire_on_commit=False
        )
    
    async def close(self):
        """Close database connection"""
        if self.engine:
            await self.engine.dispose()
    
    async def list_tables(self) -> List[str]:
        """List all tables in the database"""
        async with self.async_session() as session:
            if 'sqlite' in self.database_url.lower():
                query = text("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
            else:
                query = text("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'")
            
            result = await session.execute(query)
            tables = [row[0] for row in result.fetchall()]
            return tables

    async def inspect_all_settings(self) -> List[Dict[str, Any]]:
        """Inspect all settings instances in the database"""
        print("🔍 Inspecting all settings instances...")
        
        # First check if the table exists
        tables = await self.list_tables()
        print(f"📋 Available tables: {', '.join(tables)}")
        
        if 'settings_instances' not in tables:
            print("⚠️  settings_instances table not found!")
            return []
        
        async with self.async_session() as session:
            # Use raw SQL to get unprocessed values
            query = text("""
                SELECT
                    id,
                    definition_id,
                    name,
                    value,
                    scope,
                    user_id,
                    created_at,
                    updated_at
                FROM settings_instances
                ORDER BY definition_id, created_at DESC
            """)
            
            result = await session.execute(query)
            rows = result.fetchall()
            
            settings_data = []
            for row in rows:
                row_dict = dict(row._mapping)
                settings_data.append(row_dict)
            
            print(f"📊 Found {len(settings_data)} settings instances")
            return settings_data
    
    async def inspect_ollama_settings(self) -> List[Dict[str, Any]]:
        """Inspect specifically Ollama-related settings"""
        print("🔍 Inspecting Ollama settings...")
        
        # First check if the table exists
        tables = await self.list_tables()
        if 'settings_instances' not in tables:
            print("⚠️  settings_instances table not found!")
            return []
        
        async with self.async_session() as session:
            query = text("""
                SELECT
                    id,
                    definition_id,
                    name,
                    value,
                    scope,
                    user_id,
                    created_at,
                    updated_at
                FROM settings_instances
                WHERE definition_id LIKE '%ollama%'
                ORDER BY created_at DESC
            """)
            
            result = await session.execute(query)
            rows = result.fetchall()
            
            ollama_settings = []
            for row in rows:
                row_dict = dict(row._mapping)
                ollama_settings.append(row_dict)
            
            print(f"📊 Found {len(ollama_settings)} Ollama settings")
            return ollama_settings
    
    def analyze_value_format(self, value: str, context: str = "") -> Dict[str, Any]:
        """Analyze the format of a stored value"""
        analysis = {
            'context': context,
            'raw_value_type': type(value).__name__,
            'raw_value_length': len(value) if value else 0,
            'raw_value_preview': repr(value[:100]) if value else None,
            'appears_encrypted': False,
            'appears_json': False,
            'appears_double_encoded': False,
            'json_parse_attempts': [],
            'final_parsed_value': None,
            'parsing_success': False
        }
        
        if not value:
            return analysis
        
        # Check if it looks encrypted (base64-like)
        if len(value) > 20 and value.replace('+', '').replace('/', '').replace('=', '').isalnum():
            analysis['appears_encrypted'] = True
        
        # Check if it looks like JSON
        if value.strip().startswith(('{', '[', '"')):
            analysis['appears_json'] = True
        
        # Check if it looks double-encoded (JSON string containing JSON)
        if value.startswith('"') and value.endswith('"') and '{' in value:
            analysis['appears_double_encoded'] = True
        
        # Attempt various parsing strategies
        parsing_attempts = [
            ('direct_json', lambda v: json.loads(v)),
            ('strip_quotes', lambda v: json.loads(v.strip().strip('"').strip("'"))),
            ('double_decode', lambda v: json.loads(json.loads(v)) if isinstance(json.loads(v), str) else json.loads(v)),
            ('unescape_quotes', lambda v: json.loads(v[1:-1].replace('\\"', '"').replace('\\\\', '\\')) if v.startswith('"') else None)
        ]
        
        for attempt_name, parse_func in parsing_attempts:
            try:
                result = parse_func(value)
                if result is not None:
                    analysis['json_parse_attempts'].append({
                        'method': attempt_name,
                        'success': True,
                        'result_type': type(result).__name__,
                        'result_preview': str(result)[:200] if result else None
                    })
                    if not analysis['parsing_success']:
                        analysis['final_parsed_value'] = result
                        analysis['parsing_success'] = True
                else:
                    analysis['json_parse_attempts'].append({
                        'method': attempt_name,
                        'success': False,
                        'error': 'Returned None'
                    })
            except Exception as e:
                analysis['json_parse_attempts'].append({
                    'method': attempt_name,
                    'success': False,
                    'error': str(e)
                })
        
        return analysis
    
    def check_encryption_service_status(self) -> Dict[str, Any]:
        """Check the status of the encryption service"""
        print("🔐 Checking encryption service status...")
        
        status = {
            'encryption_enabled': False,
            'settings_field_encrypted': False,
            'encryption_key_available': False,
            'error': None
        }
        
        try:
            # Check if encryption service is generally available
            status['encryption_enabled'] = hasattr(encryption_service, 'encrypt_field')
            
            # Check if encryption is enabled for settings_instances.value
            try:
                status['settings_field_encrypted'] = encryption_service.should_encrypt_field(
                    'settings_instances', 'value'
                )
            except Exception as e:
                status['settings_field_encrypted'] = False
                print(f"⚠️  Could not check field encryption status: {e}")
            
            # Try to check if encryption key is available (without exposing it)
            try:
                test_value = "test"
                encrypted = encryption_service.encrypt_field('test_table', 'test_field', test_value)
                decrypted = encryption_service.decrypt_field('test_table', 'test_field', encrypted)
                status['encryption_key_available'] = (decrypted == test_value)
            except Exception as e:
                status['encryption_key_available'] = False
                status['error'] = f"Encryption test failed: {str(e)}"
                print(f"⚠️  Encryption key test failed: {e}")
                
        except Exception as e:
            status['error'] = f"Encryption service check failed: {str(e)}"
            print(f"❌ Encryption service check failed: {e}")
        
        return status
    
    async def detailed_analysis_report(self) -> Dict[str, Any]:
        """Generate a detailed analysis report"""
        print("📋 Generating detailed analysis report...")
        
        report = {
            'timestamp': asyncio.get_event_loop().time(),
            'encryption_status': self.check_encryption_service_status(),
            'all_settings': await self.inspect_all_settings(),
            'ollama_settings': await self.inspect_ollama_settings(),
            'value_analyses': [],
            'summary': {
                'total_settings': 0,
                'ollama_settings_count': 0,
                'encrypted_values': 0,
                'json_values': 0,
                'double_encoded_values': 0,
                'parsing_failures': 0,
                'parsing_successes': 0
            }
        }
        
        # Analyze each setting value
        all_settings = report['all_settings']
        report['summary']['total_settings'] = len(all_settings)
        
        for setting in all_settings:
            if setting['value']:
                context = f"{setting['definition_id']}:{setting['name']}"
                analysis = self.analyze_value_format(setting['value'], context)
                analysis['setting_id'] = setting['id']
                analysis['definition_id'] = setting['definition_id']
                analysis['setting_name'] = setting['name']
                report['value_analyses'].append(analysis)
                
                # Update summary
                if analysis['appears_encrypted']:
                    report['summary']['encrypted_values'] += 1
                if analysis['appears_json']:
                    report['summary']['json_values'] += 1
                if analysis['appears_double_encoded']:
                    report['summary']['double_encoded_values'] += 1
                if analysis['parsing_success']:
                    report['summary']['parsing_successes'] += 1
                else:
                    report['summary']['parsing_failures'] += 1
        
        report['summary']['ollama_settings_count'] = len(report['ollama_settings'])
        
        return report
    
    def print_summary(self, report: Dict[str, Any]):
        """Print a human-readable summary of the analysis"""
        print("\n" + "="*80)
        print("📊 SETTINGS ENCRYPTION ANALYSIS SUMMARY")
        print("="*80)
        
        # Encryption status
        enc_status = report['encryption_status']
        print(f"🔐 Encryption Service Status:")
        print(f"   - Encryption Enabled: {enc_status['encryption_enabled']}")
        print(f"   - Settings Field Encrypted: {enc_status['settings_field_encrypted']}")
        print(f"   - Encryption Key Available: {enc_status['encryption_key_available']}")
        if enc_status['error']:
            print(f"   - Error: {enc_status['error']}")
        
        # Summary statistics
        summary = report['summary']
        print(f"\n📈 Statistics:")
        print(f"   - Total Settings: {summary['total_settings']}")
        print(f"   - Ollama Settings: {summary['ollama_settings_count']}")
        print(f"   - Encrypted Values: {summary['encrypted_values']}")
        print(f"   - JSON Values: {summary['json_values']}")
        print(f"   - Double-Encoded Values: {summary['double_encoded_values']}")
        print(f"   - Parsing Successes: {summary['parsing_successes']}")
        print(f"   - Parsing Failures: {summary['parsing_failures']}")
        
        # Ollama-specific analysis
        print(f"\n🤖 Ollama Settings Analysis:")
        ollama_analyses = [a for a in report['value_analyses'] if 'ollama' in a['definition_id'].lower()]
        
        if not ollama_analyses:
            print("   - No Ollama settings found")
        else:
            for analysis in ollama_analyses:
                print(f"\n   Setting: {analysis['setting_name']} ({analysis['setting_id']})")
                print(f"   - Definition ID: {analysis['definition_id']}")
                print(f"   - Value Length: {analysis['raw_value_length']}")
                print(f"   - Appears Encrypted: {analysis['appears_encrypted']}")
                print(f"   - Appears JSON: {analysis['appears_json']}")
                print(f"   - Appears Double-Encoded: {analysis['appears_double_encoded']}")
                print(f"   - Parsing Success: {analysis['parsing_success']}")
                
                if analysis['json_parse_attempts']:
                    print(f"   - Parse Attempts:")
                    for attempt in analysis['json_parse_attempts']:
                        status = "✅" if attempt['success'] else "❌"
                        print(f"     {status} {attempt['method']}: {attempt.get('error', 'Success')}")
                
                if not analysis['parsing_success']:
                    print(f"   - Raw Value Preview: {analysis['raw_value_preview']}")
        
        print("\n" + "="*80)
    
    async def save_report(self, report: Dict[str, Any], filename: str = None):
        """Save the detailed report to a JSON file"""
        if not filename:
            import datetime
            timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
            filename = f"settings_encryption_analysis_{timestamp}.json"
        
        filepath = Path(backend_dir) / "scripts" / filename
        
        with open(filepath, 'w') as f:
            json.dump(report, f, indent=2, default=str)
        
        print(f"💾 Detailed report saved to: {filepath}")


async def main():
    """Main inspection function"""
    print("🚀 Starting Settings Encryption Inspection")
    print("="*50)
    
    inspector = SettingsInspector()
    
    try:
        await inspector.initialize()
        
        # Generate detailed analysis
        report = await inspector.detailed_analysis_report()
        
        # Print summary
        inspector.print_summary(report)
        
        # Save detailed report
        await inspector.save_report(report)
        
        # Check for specific issues
        print("\n🔍 Checking for specific issues...")
        
        # Look for double-encoded values
        double_encoded = [a for a in report['value_analyses'] if a['appears_double_encoded']]
        if double_encoded:
            print(f"⚠️  Found {len(double_encoded)} potentially double-encoded values:")
            for analysis in double_encoded:
                print(f"   - {analysis['definition_id']}:{analysis['setting_name']}")
        
        # Look for parsing failures
        parse_failures = [a for a in report['value_analyses'] if not a['parsing_success']]
        if parse_failures:
            print(f"❌ Found {len(parse_failures)} values that failed to parse:")
            for analysis in parse_failures:
                print(f"   - {analysis['definition_id']}:{analysis['setting_name']}")
        
        # Specific Ollama issue check
        ollama_failures = [a for a in parse_failures if 'ollama' in a['definition_id'].lower()]
        if ollama_failures:
            print(f"\n🤖 OLLAMA-SPECIFIC PARSING FAILURES: {len(ollama_failures)}")
            print("This confirms the reported issue with Ollama settings!")
            for analysis in ollama_failures:
                print(f"   - Setting: {analysis['setting_name']}")
                print(f"   - ID: {analysis['setting_id']}")
                print(f"   - Raw value preview: {analysis['raw_value_preview']}")
        
    except Exception as e:
        print(f"❌ Error during inspection: {e}")
        import traceback
        traceback.print_exc()
    
    finally:
        await inspector.close()
    
    print("\n✅ Inspection complete!")


if __name__ == "__main__":
    asyncio.run(main())