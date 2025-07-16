#!/usr/bin/env python3
"""
BrainDrive Network Plugin Validation Script
Validates the plugin structure and initializer for the BrainDrive Network plugin
"""

import ast
import json
import sys
from pathlib import Path

def validate_plugin():
    """Validate BrainDrive Network plugin structure and initializer"""
    errors = []
    warnings = []

    print("🔍 Validating BrainDrive Network Plugin...")

    # Check required files
    required_files = [
        'plugin_initializer.py',
        'package.json',
        'src/ComponentNetworkStatus.tsx',
        'src/index.tsx',
        'webpack.config.js',
        'tsconfig.json'
    ]

    for file in required_files:
        if not Path(file).exists():
            errors.append(f"❌ Required file missing: {file}")
        else:
            print(f"✅ Found required file: {file}")

    # Validate plugin_initializer.py
    if Path('plugin_initializer.py').exists():
        try:
            with open('plugin_initializer.py', 'r') as f:
                content = f.read()

            # Parse the Python file
            tree = ast.parse(content)

            # Check for required class
            initializer_class_found = False
            required_methods = ['initialize', 'cleanup']
            found_methods = []

            for node in ast.walk(tree):
                if isinstance(node, ast.ClassDef):
                    if node.name == 'BrainDriveNetworkInitializer':
                        initializer_class_found = True

                        # Check for required methods
                        for item in node.body:
                            if isinstance(item, ast.AsyncFunctionDef) and item.name in required_methods:
                                found_methods.append(item.name)
                        break

            if not initializer_class_found:
                errors.append("❌ BrainDriveNetworkInitializer class not found in plugin_initializer.py")
            else:
                print("✅ BrainDriveNetworkInitializer class found")

                # Check required methods
                for method in required_methods:
                    if method in found_methods:
                        print(f"✅ Required method '{method}' found")
                    else:
                        errors.append(f"❌ Required method '{method}' missing from initializer class")

        except SyntaxError as e:
            errors.append(f"❌ Syntax error in plugin_initializer.py: {e}")
        except Exception as e:
            errors.append(f"❌ Error parsing plugin_initializer.py: {e}")

    # Validate package.json
    if Path('package.json').exists():
        try:
            with open('package.json', 'r') as f:
                pkg = json.load(f)

            required_fields = ['name', 'version', 'description']
            for field in required_fields:
                if field not in pkg:
                    errors.append(f"❌ package.json missing required field: {field}")
                else:
                    print(f"✅ package.json has required field: {field}")

            # Check BrainDrive configuration
            if 'braindrive' not in pkg:
                errors.append("❌ package.json missing 'braindrive' configuration")
            else:
                braindrive_config = pkg['braindrive']
                required_braindrive_fields = ['pluginType', 'initializer', 'compatibility']

                for field in required_braindrive_fields:
                    if field not in braindrive_config:
                        errors.append(f"❌ braindrive config missing required field: {field}")
                    else:
                        print(f"✅ braindrive config has required field: {field}")

                # Validate plugin type
                if braindrive_config.get('pluginType') != 'frontend':
                    warnings.append("⚠️  Plugin type is not 'frontend' - this may cause issues")

                # Validate initializer reference
                if braindrive_config.get('initializer') != 'plugin_initializer.py':
                    errors.append("❌ braindrive config initializer should reference 'plugin_initializer.py'")

                # Check permissions
                permissions = braindrive_config.get('permissions', [])
                required_permissions = ['network.read']
                for perm in required_permissions:
                    if perm not in permissions:
                        warnings.append(f"⚠️  Recommended permission '{perm}' not found")
                    else:
                        print(f"✅ Required permission '{perm}' found")

        except json.JSONDecodeError as e:
            errors.append(f"❌ Invalid JSON in package.json: {e}")
        except Exception as e:
            errors.append(f"❌ Error parsing package.json: {e}")

    # Validate TypeScript configuration
    if Path('tsconfig.json').exists():
        try:
            with open('tsconfig.json', 'r') as f:
                ts_config = json.load(f)
            print("✅ tsconfig.json is valid JSON")
        except json.JSONDecodeError as e:
            errors.append(f"❌ Invalid JSON in tsconfig.json: {e}")

    # Validate webpack configuration
    if Path('webpack.config.js').exists():
        print("✅ webpack.config.js found")
        # Could add more sophisticated webpack config validation here

    # Check for React component files
    component_files = [
        'src/ComponentNetworkStatus.tsx',
        'src/index.tsx'
    ]

    for component_file in component_files:
        if Path(component_file).exists():
            try:
                with open(component_file, 'r') as f:
                    content = f.read()

                # Basic checks for React component structure
                if 'import React' in content or 'import * as React' in content:
                    print(f"✅ {component_file} imports React")
                else:
                    warnings.append(f"⚠️  {component_file} may not be importing React properly")

                if 'export default' in content:
                    print(f"✅ {component_file} has default export")
                else:
                    warnings.append(f"⚠️  {component_file} may not have a default export")

            except Exception as e:
                errors.append(f"❌ Error reading {component_file}: {e}")

    # Check build output
    if Path('dist').exists():
        print("✅ Build output directory found")

        # Check for specific build artifacts
        build_files = ['remoteEntry.js']
        for build_file in build_files:
            build_path = Path('dist') / build_file
            if build_path.exists():
                print(f"✅ Build artifact found: {build_file}")
            else:
                warnings.append(f"⚠️  Build artifact missing: {build_file} (run 'npm run build')")
    else:
        warnings.append("⚠️  No build output found. Run 'npm run build' to generate dist files.")

    # Check for CSS files
    css_files = ['src/ComponentNetworkStatus.css', 'src/index.css']
    for css_file in css_files:
        if Path(css_file).exists():
            print(f"✅ CSS file found: {css_file}")
        else:
            warnings.append(f"⚠️  CSS file missing: {css_file}")

    # Validate network monitoring specific requirements
    if Path('src/ComponentNetworkStatus.tsx').exists():
        try:
            with open('src/ComponentNetworkStatus.tsx', 'r') as f:
                content = f.read()

            # Check for network monitoring functionality
            network_keywords = ['fetch', 'network', 'status', 'connectivity']
            found_keywords = []

            for keyword in network_keywords:
                if keyword.lower() in content.lower():
                    found_keywords.append(keyword)

            if found_keywords:
                print(f"✅ Network monitoring keywords found: {', '.join(found_keywords)}")
            else:
                warnings.append("⚠️  No network monitoring keywords found in main component")

        except Exception as e:
            errors.append(f"❌ Error validating network component: {e}")

    # Summary
    print("\n" + "="*50)
    print("VALIDATION SUMMARY")
    print("="*50)

    if warnings:
        print("\n⚠️  WARNINGS:")
        for warning in warnings:
            print(f"  {warning}")

    if errors:
        print("\n❌ ERRORS:")
        for error in errors:
            print(f"  {error}")
        print(f"\n❌ Plugin validation failed with {len(errors)} error(s)")
        return False
    else:
        if warnings:
            print(f"\n🎉 Plugin validation passed with {len(warnings)} warning(s)!")
        else:
            print("\n🎉 Plugin validation passed perfectly!")
        return True

def validate_network_functionality():
    """Additional validation for network monitoring functionality"""
    print("\n🌐 Validating network monitoring functionality...")

    # Check if the component has proper network checking logic
    component_path = Path('src/ComponentNetworkStatus.tsx')
    if component_path.exists():
        with open(component_path, 'r') as f:
            content = f.read()

        # Look for essential network monitoring patterns
        patterns = {
            'fetch_usage': 'fetch(',
            'timeout_handling': 'timeout',
            'error_handling': 'catch',
            'status_management': 'useState',
            'effect_hook': 'useEffect'
        }

        found_patterns = []
        for pattern_name, pattern in patterns.items():
            if pattern in content:
                found_patterns.append(pattern_name)
                print(f"✅ Found {pattern_name.replace('_', ' ')}")

        if len(found_patterns) >= 4:
            print("✅ Network monitoring component appears to be well-structured")
            return True
        else:
            print(f"⚠️  Network monitoring component may be missing some functionality")
            return False

    return False

if __name__ == "__main__":
    print("BrainDrive Network Plugin Validator")
    print("="*40)

    # Change to plugin directory if script is run from elsewhere
    script_dir = Path(__file__).parent
    plugin_dir = script_dir.parent

    if plugin_dir.name == 'BrainDriveNetwork':
        import os
        os.chdir(plugin_dir)
        print(f"📁 Working directory: {plugin_dir}")

    # Run main validation
    success = validate_plugin()

    # Run network-specific validation
    network_success = validate_network_functionality()

    # Final result
    overall_success = success and network_success

    if overall_success:
        print("\n🚀 BrainDrive Network plugin is ready for deployment!")
    else:
        print("\n🔧 BrainDrive Network plugin needs fixes before deployment.")

    sys.exit(0 if overall_success else 1)