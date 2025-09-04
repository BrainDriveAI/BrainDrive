#!/bin/bash

# Phase 1 Testing Script
# This script helps test the Phase 1 instrumentation and verification features

echo "========================================="
echo "Phase 1 Testing - Instrumentation & Verification"
echo "========================================="
echo ""
echo "This script will guide you through testing the Phase 1 implementation."
echo ""

# Check if VITE_LAYOUT_DEBUG is set
if [ -z "$VITE_LAYOUT_DEBUG" ]; then
    echo "⚠️  VITE_LAYOUT_DEBUG is not set. Setting it to 'true' for testing..."
    export VITE_LAYOUT_DEBUG=true
fi

# Check if VITE_USE_UNIFIED_RENDERER is set
if [ -z "$VITE_USE_UNIFIED_RENDERER" ]; then
    echo "⚠️  VITE_USE_UNIFIED_RENDERER is not set. Setting it to 'true' for testing..."
    export VITE_USE_UNIFIED_RENDERER=true
fi

echo ""
echo "Environment Variables:"
echo "  VITE_LAYOUT_DEBUG=$VITE_LAYOUT_DEBUG"
echo "  VITE_USE_UNIFIED_RENDERER=$VITE_USE_UNIFIED_RENDERER"
echo ""

echo "Test Checklist:"
echo "==============="
echo ""
echo "1. Layout Commit Badge:"
echo "   [ ] Badge appears in bottom-right corner"
echo "   [ ] Shows version number (v0, v1, v2...)"
echo "   [ ] Shows hash (6 characters)"
echo "   [ ] Shows 'Committed' or 'Pending' status"
echo "   [ ] Shows time since last commit"
echo ""
echo "2. Console Logging Chain:"
echo "   Open browser DevTools console and verify these logs appear:"
echo "   [ ] [LayoutEngine] Commit v{version} hash:{hash}"
echo "   [ ] [UnifiedLayoutState] Persist v{version} hash:{hash}"
echo "   [ ] [PluginStudioAdapter] Convert v{version} hash:{hash}"
echo "   [ ] [useLayout] Apply v{version} hash:{hash}"
echo "   [ ] [savePage] Serialize v{version} hash:{hash}"
echo ""
echo "3. Version/Hash Consistency:"
echo "   [ ] Same version/hash appears through entire pipeline"
echo "   [ ] Version increments on each layout change"
echo "   [ ] Hash changes when layout content changes"
echo "   [ ] Hash stays same for identical layouts"
echo ""
echo "4. Test Scenarios:"
echo "   a. Resize a module:"
echo "      [ ] Version increments"
echo "      [ ] New hash generated"
echo "      [ ] Badge updates to show new version"
echo "      [ ] Console shows commit chain"
echo ""
echo "   b. Drag/move a module:"
echo "      [ ] Version increments"
echo "      [ ] New hash generated"
echo "      [ ] Badge updates"
echo "      [ ] Console shows commit chain"
echo ""
echo "   c. Save the page:"
echo "      [ ] [savePage] log appears with current version/hash"
echo "      [ ] Save completes successfully"
echo ""
echo "   d. Add a new module:"
echo "      [ ] Version increments"
echo "      [ ] New hash generated"
echo "      [ ] Badge updates"
echo ""
echo "5. No Behavior Changes:"
echo "   [ ] Layout operations work as before"
echo "   [ ] No errors in console"
echo "   [ ] No performance degradation"
echo ""

echo "Starting frontend with debug mode enabled..."
echo "Press Ctrl+C to stop the server when testing is complete."
echo ""

# Navigate to frontend directory and start dev server
cd /home/hacker/BrainDriveDev/BrainDrive/frontend
npm run dev