-- Test Script: Setup Plugin for Update/Delete Testing
-- This script demonstrates how to set up a plugin to show the update and delete buttons

-- Example 1: Set up a plugin with update available
-- Replace 'your-plugin-id' with an actual plugin ID from your database
UPDATE plugin
SET
    source_url = 'https://github.com/example/test-plugin',
    source_type = 'github',
    update_check_url = 'https://api.github.com/repos/example/test-plugin/releases/latest',
    update_available = true,
    latest_version = '1.2.0',
    installation_type = 'remote',
    last_update_check = NOW()
WHERE id = 'your-plugin-id';

-- Example 2: Set up a plugin that can be deleted but has no update
-- Replace 'another-plugin-id' with an actual plugin ID from your database
UPDATE plugin
SET
    source_url = 'https://github.com/example/another-plugin',
    source_type = 'github',
    update_available = false,
    installation_type = 'remote'
WHERE id = 'another-plugin-id';

-- Example 3: Query to see all plugins with their update status
SELECT
    id,
    name,
    version,
    source_url,
    source_type,
    update_available,
    latest_version,
    installation_type
FROM plugin
WHERE source_url IS NOT NULL;

-- Example 4: Reset a plugin to local (no update/delete buttons will show)
-- UPDATE plugin
-- SET
--     source_url = NULL,
--     source_type = NULL,
--     update_available = false,
--     latest_version = NULL,
--     installation_type = 'local'
-- WHERE id = 'plugin-to-reset';