#!/bin/bash

echo "🔧 Auto-Building BrainDrive Plugins..."

# Go to project root (this script should live in root)
cd "$(dirname "$0")"

for plugin_dir in plugins/*/; do
  if [[ -f "$plugin_dir/package.json" ]]; then
    echo "📁 Building plugin: $(basename "$plugin_dir")"
    cd "$plugin_dir" || exit
    npm install
    npm run build
    cd - >/dev/null || exit
  else
    echo "⚠️ Skipping $(basename "$plugin_dir") (no package.json found)"
  fi
done

echo "✅ All detectable plugins have been built."