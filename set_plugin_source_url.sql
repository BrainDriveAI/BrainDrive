-- Quick script to set a plugin to have source URL for testing
-- Replace 'PLUGIN_ID_HERE' with an actual plugin ID from your database

-- First, let's see what plugins exist
SELECT id, name, version, source_url, update_available
FROM plugin
LIMIT 5;

-- Set a plugin to have source URL and update available (for testing update button)
-- UPDATE plugin
-- SET
--     source_url = 'https://github.com/example/test-plugin',
--     source_type = 'github',
--     update_available = true,
--     latest_version = '2.0.0',
--     installation_type = 'remote'
-- WHERE id = 'PLUGIN_ID_HERE';

-- Set a plugin to have source URL but no update (for testing delete button only)
-- UPDATE plugin
-- SET
--     source_url = 'https://github.com/example/another-plugin',
--     source_type = 'github',
--     update_available = false,
--     installation_type = 'remote'
-- WHERE id = 'ANOTHER_PLUGIN_ID_HERE';

-- Check the results
-- SELECT id, name, version, source_url, update_available, latest_version
-- FROM plugin
-- WHERE source_url IS NOT NULL;