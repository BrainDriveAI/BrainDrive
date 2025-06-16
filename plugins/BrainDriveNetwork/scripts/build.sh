#!/bin/bash
#
# BrainDrive Network Plugin Build Script
# Builds the plugin for distribution and deployment
#

set -e  # Exit on any error

echo "🔨 Building BrainDrive Network Plugin..."

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_DIR="$(dirname "$SCRIPT_DIR")"

# Change to plugin directory
cd "$PLUGIN_DIR"

echo "📁 Working directory: $PLUGIN_DIR"

# Check if package.json exists
if [ ! -f "package.json" ]; then
    echo "❌ package.json not found in $PLUGIN_DIR"
    exit 1
fi

# Check if node_modules exists, if not install dependencies
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
else
    echo "✅ Dependencies already installed"
fi

# Clean previous build
if [ -d "dist" ]; then
    echo "🧹 Cleaning previous build..."
    rm -rf dist
fi

# Run TypeScript compilation check
echo "🔍 Checking TypeScript compilation..."
if command -v npx &> /dev/null; then
    npx tsc --noEmit
    echo "✅ TypeScript compilation check passed"
else
    echo "⚠️  npx not found, skipping TypeScript check"
fi

# Build the plugin
echo "🏗️  Building plugin..."
npm run build

# Check if build was successful
if [ ! -d "dist" ]; then
    echo "❌ Build failed - dist directory not created"
    exit 1
fi

if [ ! -f "dist/remoteEntry.js" ]; then
    echo "❌ Build failed - remoteEntry.js not found"
    exit 1
fi

echo "✅ Build completed successfully"

# Run validation
echo "🔍 Validating plugin..."
if [ -f "scripts/validate.py" ]; then
    python3 scripts/validate.py
    if [ $? -eq 0 ]; then
        echo "✅ Plugin validation passed"
    else
        echo "❌ Plugin validation failed"
        exit 1
    fi
else
    echo "⚠️  Validation script not found, skipping validation"
fi

# Create build info
BUILD_INFO_FILE="dist/build_info.json"
echo "📝 Creating build info..."

cat > "$BUILD_INFO_FILE" << EOF
{
  "plugin_name": "BrainDrive Network",
  "plugin_slug": "braindrive_network",
  "version": "$(node -p "require('./package.json').version")",
  "build_date": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "build_environment": "$(uname -s)",
  "node_version": "$(node --version)",
  "npm_version": "$(npm --version)",
  "git_commit": "$(git rev-parse HEAD 2>/dev/null || echo 'unknown')",
  "git_branch": "$(git branch --show-current 2>/dev/null || echo 'unknown')"
}
EOF

echo "✅ Build info created: $BUILD_INFO_FILE"

# Display build summary
echo ""
echo "🎉 Build Summary"
echo "================"
echo "Plugin: BrainDrive Network"
echo "Version: $(node -p "require('./package.json').version")"
echo "Build Date: $(date)"
echo "Output Directory: $PLUGIN_DIR/dist"
echo ""

# List built files
echo "📁 Built Files:"
find dist -type f -name "*.js" -o -name "*.css" -o -name "*.json" | sort | while read file; do
    size=$(du -h "$file" | cut -f1)
    echo "  $file ($size)"
done

echo ""
echo "🚀 Plugin is ready for deployment!"
echo ""
echo "Next steps:"
echo "  1. Test the plugin locally"
echo "  2. Run 'npm run validate' to ensure everything is correct"
echo "  3. Deploy to your BrainDrive instance"
echo ""