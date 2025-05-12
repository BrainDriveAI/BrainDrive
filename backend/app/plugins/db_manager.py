import sqlite3
import json
import logging
from pathlib import Path
from typing import Dict, List, Any, Optional, Tuple, Union
import structlog

logger = structlog.get_logger()

class PluginDatabaseManager:
    """
    Manages plugin data in SQLite database.
    Handles CRUD operations for plugins and modules.
    """
    
    def __init__(self, db_path: str):
        """
        Initialize the database manager.
        
        Args:
            db_path: Path to the SQLite database file
        """
        self.db_path = db_path
        self.conn = self._create_connection()
        self._initialize_tables()
        
    def _create_connection(self) -> sqlite3.Connection:
        """Create a database connection to the SQLite database."""
        try:
            # Enable foreign key constraints
            conn = sqlite3.connect(self.db_path)
            conn.execute("PRAGMA foreign_keys = ON")
            conn.row_factory = sqlite3.Row  # Return rows as dictionaries
            return conn
        except sqlite3.Error as e:
            logger.error("Error connecting to database", error=str(e))
            raise
            
    def _initialize_tables(self):
        """Create tables if they don't exist."""
        try:
            cursor = self.conn.cursor()
            
            # Create plugins table
            cursor.execute('''
            CREATE TABLE IF NOT EXISTS plugins (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT NOT NULL,
                version TEXT NOT NULL,
                type TEXT DEFAULT 'frontend',
                enabled INTEGER DEFAULT 1,
                icon TEXT,
                category TEXT,
                status TEXT DEFAULT 'activated',
                official INTEGER DEFAULT 1,
                author TEXT DEFAULT 'BrainDrive Team',
                last_updated TEXT,
                compatibility TEXT DEFAULT '1.0.0',
                downloads INTEGER DEFAULT 0,
                scope TEXT,
                bundle_method TEXT,
                bundle_location TEXT,
                is_local INTEGER DEFAULT 0,
                long_description TEXT,
                config_fields TEXT,
                messages TEXT,
                dependencies TEXT,
                created_at TEXT DEFAULT (datetime('now')),
                updated_at TEXT DEFAULT (datetime('now'))
            )
            ''')
            
            # Create index on enabled status
            cursor.execute('''
            CREATE INDEX IF NOT EXISTS idx_plugins_enabled ON plugins(enabled)
            ''')
            
            # Create modules table
            cursor.execute('''
            CREATE TABLE IF NOT EXISTS modules (
                id TEXT NOT NULL,
                plugin_id TEXT NOT NULL,
                name TEXT NOT NULL,
                display_name TEXT,
                description TEXT,
                icon TEXT,
                category TEXT,
                enabled INTEGER DEFAULT 1,
                priority INTEGER DEFAULT 0,
                props TEXT,
                config_fields TEXT,
                messages TEXT,
                required_services TEXT,
                dependencies TEXT,
                layout TEXT,
                tags TEXT,
                created_at TEXT DEFAULT (datetime('now')),
                updated_at TEXT DEFAULT (datetime('now')),
                PRIMARY KEY (plugin_id, id),
                FOREIGN KEY (plugin_id) REFERENCES plugins(id) ON DELETE CASCADE
            )
            ''')
            
            # Create index on enabled status
            cursor.execute('''
            CREATE INDEX IF NOT EXISTS idx_modules_enabled ON modules(enabled)
            ''')
            
            self.conn.commit()
            logger.info("Database tables initialized")
        except sqlite3.Error as e:
            logger.error("Error initializing database tables", error=str(e))
            raise
            
    def _serialize_json_field(self, data: Any) -> Optional[str]:
        """Serialize data to JSON string."""
        if data is None:
            return None
        return json.dumps(data)
        
    def _deserialize_json_field(self, json_str: Optional[str]) -> Any:
        """Deserialize JSON string to Python object."""
        if json_str is None:
            return None
        try:
            return json.loads(json_str)
        except (json.JSONDecodeError, TypeError):
            return {}
            
    def get_all_plugins(self) -> List[Dict[str, Any]]:
        """Get all plugins with basic info."""
        try:
            cursor = self.conn.cursor()
            cursor.execute('''
            SELECT * FROM plugins WHERE enabled = 1
            ''')
            
            plugins = []
            for row in cursor.fetchall():
                plugin_dict = dict(row)
                
                # Deserialize JSON fields
                for field in ['config_fields', 'messages', 'dependencies']:
                    if plugin_dict[field]:
                        plugin_dict[field] = self._deserialize_json_field(plugin_dict[field])
                    else:
                        plugin_dict[field] = {} if field != 'dependencies' else []
                
                # Convert SQLite integers to booleans
                for field in ['enabled', 'official', 'is_local']:
                    plugin_dict[field] = bool(plugin_dict[field])
                
                plugins.append(plugin_dict)
                
            return plugins
        except sqlite3.Error as e:
            logger.error("Error getting all plugins", error=str(e))
            raise
            
    def get_all_plugins_with_modules(self) -> List[Dict[str, Any]]:
        """Get all plugins with their modules."""
        try:
            # Get all plugins
            plugins = self.get_all_plugins()
            
            # For each plugin, get its modules
            for plugin in plugins:
                plugin['modules'] = self.get_plugin_modules(plugin['id'])
                
            return plugins
        except sqlite3.Error as e:
            logger.error("Error getting plugins with modules", error=str(e))
            raise
            
    def get_plugin(self, plugin_id: str) -> Optional[Dict[str, Any]]:
        """Get a specific plugin by ID."""
        try:
            cursor = self.conn.cursor()
            cursor.execute('''
            SELECT * FROM plugins WHERE id = ?
            ''', (plugin_id,))
            
            row = cursor.fetchone()
            if not row:
                return None
                
            plugin_dict = dict(row)
            
            # Deserialize JSON fields
            for field in ['config_fields', 'messages', 'dependencies']:
                if plugin_dict[field]:
                    plugin_dict[field] = self._deserialize_json_field(plugin_dict[field])
                else:
                    plugin_dict[field] = {} if field != 'dependencies' else []
            
            # Convert SQLite integers to booleans
            for field in ['enabled', 'official', 'is_local']:
                plugin_dict[field] = bool(plugin_dict[field])
                
            return plugin_dict
        except sqlite3.Error as e:
            logger.error("Error getting plugin", plugin_id=plugin_id, error=str(e))
            raise
            
    def get_plugin_modules(self, plugin_id: str) -> List[Dict[str, Any]]:
        """Get all modules for a specific plugin."""
        try:
            cursor = self.conn.cursor()
            cursor.execute('''
            SELECT * FROM modules WHERE plugin_id = ?
            ''', (plugin_id,))
            
            modules = []
            for row in cursor.fetchall():
                module_dict = dict(row)
                
                # Deserialize JSON fields
                for field in ['props', 'config_fields', 'messages', 'required_services', 
                             'dependencies', 'layout', 'tags']:
                    if module_dict[field]:
                        module_dict[field] = self._deserialize_json_field(module_dict[field])
                    else:
                        if field in ['props', 'config_fields', 'required_services', 'layout']:
                            module_dict[field] = {}
                        elif field in ['dependencies', 'tags']:
                            module_dict[field] = []
                        elif field == 'messages':
                            module_dict[field] = {'sends': [], 'receives': []}
                
                # Convert SQLite integers to booleans
                module_dict['enabled'] = bool(module_dict['enabled'])
                
                modules.append(module_dict)
                
            return modules
        except sqlite3.Error as e:
            logger.error("Error getting plugin modules", plugin_id=plugin_id, error=str(e))
            raise
            
    def get_module(self, plugin_id: str, module_id: str) -> Optional[Dict[str, Any]]:
        """Get a specific module from a plugin."""
        try:
            cursor = self.conn.cursor()
            cursor.execute('''
            SELECT * FROM modules WHERE plugin_id = ? AND id = ?
            ''', (plugin_id, module_id))
            
            row = cursor.fetchone()
            if not row:
                return None
                
            module_dict = dict(row)
            
            # Deserialize JSON fields
            for field in ['props', 'config_fields', 'messages', 'required_services', 
                         'dependencies', 'layout', 'tags']:
                if module_dict[field]:
                    module_dict[field] = self._deserialize_json_field(module_dict[field])
                else:
                    if field in ['props', 'config_fields', 'required_services', 'layout']:
                        module_dict[field] = {}
                    elif field in ['dependencies', 'tags']:
                        module_dict[field] = []
                    elif field == 'messages':
                        module_dict[field] = {'sends': [], 'receives': []}
            
            # Convert SQLite integers to booleans
            module_dict['enabled'] = bool(module_dict['enabled'])
                
            return module_dict
        except sqlite3.Error as e:
            logger.error("Error getting module", 
                        plugin_id=plugin_id, 
                        module_id=module_id, 
                        error=str(e))
            raise
            
    def insert_plugin(self, plugin_data: Dict[str, Any]) -> str:
        """Insert a new plugin."""
        try:
            # Extract modules from plugin data
            modules = plugin_data.pop('modules', [])
            
            # Prepare plugin data for insertion
            plugin_id = plugin_data['id']
            
            # Serialize JSON fields
            for field in ['config_fields', 'messages', 'dependencies']:
                if field in plugin_data:
                    plugin_data[field] = self._serialize_json_field(plugin_data[field])
            
            # Convert booleans to SQLite integers
            for field in ['enabled', 'official', 'is_local']:
                if field in plugin_data and plugin_data[field] is not None:
                    plugin_data[field] = 1 if plugin_data[field] else 0
            
            # Build the SQL query dynamically based on available fields
            fields = []
            placeholders = []
            values = []
            
            for key, value in plugin_data.items():
                # Convert camelCase to snake_case for database fields
                db_key = ''.join(['_' + c.lower() if c.isupper() else c for c in key]).lstrip('_')
                
                fields.append(db_key)
                placeholders.append('?')
                values.append(value)
            
            query = f'''
            INSERT INTO plugins ({', '.join(fields)})
            VALUES ({', '.join(placeholders)})
            '''
            
            cursor = self.conn.cursor()
            cursor.execute(query, values)
            
            # Insert modules
            for module in modules:
                self.insert_module(plugin_id, module)
            
            self.conn.commit()
            return plugin_id
        except sqlite3.Error as e:
            self.conn.rollback()
            logger.error("Error inserting plugin", 
                        plugin_id=plugin_data.get('id'), 
                        error=str(e))
            raise
            
    def insert_module(self, plugin_id: str, module_data: Dict[str, Any]) -> Tuple[str, str]:
        """Insert a new module for a plugin."""
        try:
            # Prepare module data for insertion
            module_id = module_data['id']
            module_data['plugin_id'] = plugin_id
            
            # Serialize JSON fields
            for field in ['props', 'config_fields', 'messages', 'required_services', 
                         'dependencies', 'layout', 'tags']:
                if field in module_data:
                    module_data[field] = self._serialize_json_field(module_data[field])
            
            # Convert booleans to SQLite integers
            if 'enabled' in module_data and module_data['enabled'] is not None:
                module_data['enabled'] = 1 if module_data['enabled'] else 0
            
            # Build the SQL query dynamically based on available fields
            fields = []
            placeholders = []
            values = []
            
            for key, value in module_data.items():
                # Convert camelCase to snake_case for database fields
                db_key = ''.join(['_' + c.lower() if c.isupper() else c for c in key]).lstrip('_')
                
                fields.append(db_key)
                placeholders.append('?')
                values.append(value)
            
            query = f'''
            INSERT INTO modules ({', '.join(fields)})
            VALUES ({', '.join(placeholders)})
            '''
            
            cursor = self.conn.cursor()
            cursor.execute(query, values)
            
            self.conn.commit()
            return (plugin_id, module_id)
        except sqlite3.Error as e:
            self.conn.rollback()
            logger.error("Error inserting module", 
                        plugin_id=plugin_id, 
                        module_id=module_data.get('id'), 
                        error=str(e))
            raise
            
    def update_plugin(self, plugin_id: str, plugin_data: Dict[str, Any]) -> bool:
        """Update an existing plugin."""
        try:
            # Get existing plugin to check if it exists
            existing_plugin = self.get_plugin(plugin_id)
            if not existing_plugin:
                logger.warning("Plugin not found for update", plugin_id=plugin_id)
                return False
            
            # Extract modules from plugin data
            modules = plugin_data.pop('modules', None)
            
            # Serialize JSON fields
            for field in ['config_fields', 'messages', 'dependencies']:
                if field in plugin_data:
                    plugin_data[field] = self._serialize_json_field(plugin_data[field])
            
            # Convert booleans to SQLite integers
            for field in ['enabled', 'official', 'is_local']:
                if field in plugin_data and plugin_data[field] is not None:
                    plugin_data[field] = 1 if plugin_data[field] else 0
            
            # Build the SQL query dynamically based on available fields
            set_clauses = []
            values = []
            
            for key, value in plugin_data.items():
                # Convert camelCase to snake_case for database fields
                db_key = ''.join(['_' + c.lower() if c.isupper() else c for c in key]).lstrip('_')
                
                set_clauses.append(f"{db_key} = ?")
                values.append(value)
            
            # Add updated_at timestamp
            set_clauses.append("updated_at = datetime('now')")
            
            query = f'''
            UPDATE plugins
            SET {', '.join(set_clauses)}
            WHERE id = ?
            '''
            
            values.append(plugin_id)
            
            cursor = self.conn.cursor()
            cursor.execute(query, values)
            
            # Update modules if provided
            if modules is not None:
                # First, delete existing modules
                cursor.execute('''
                DELETE FROM modules WHERE plugin_id = ?
                ''', (plugin_id,))
                
                # Then insert new modules
                for module in modules:
                    self.insert_module(plugin_id, module)
            
            self.conn.commit()
            return True
        except sqlite3.Error as e:
            self.conn.rollback()
            logger.error("Error updating plugin", 
                        plugin_id=plugin_id, 
                        error=str(e))
            raise
            
    def update_module(self, plugin_id: str, module_id: str, module_data: Dict[str, Any]) -> bool:
        """Update an existing module."""
        try:
            # Get existing module to check if it exists
            existing_module = self.get_module(plugin_id, module_id)
            if not existing_module:
                logger.warning("Module not found for update", 
                              plugin_id=plugin_id, 
                              module_id=module_id)
                return False
            
            # Serialize JSON fields
            for field in ['props', 'config_fields', 'messages', 'required_services', 
                         'dependencies', 'layout', 'tags']:
                if field in module_data:
                    module_data[field] = self._serialize_json_field(module_data[field])
            
            # Convert booleans to SQLite integers
            if 'enabled' in module_data and module_data['enabled'] is not None:
                module_data['enabled'] = 1 if module_data['enabled'] else 0
            
            # Build the SQL query dynamically based on available fields
            set_clauses = []
            values = []
            
            for key, value in module_data.items():
                if key == 'id' or key == 'plugin_id':
                    continue  # Skip primary key fields
                
                # Convert camelCase to snake_case for database fields
                db_key = ''.join(['_' + c.lower() if c.isupper() else c for c in key]).lstrip('_')
                
                set_clauses.append(f"{db_key} = ?")
                values.append(value)
            
            # Add updated_at timestamp
            set_clauses.append("updated_at = datetime('now')")
            
            query = f'''
            UPDATE modules
            SET {', '.join(set_clauses)}
            WHERE plugin_id = ? AND id = ?
            '''
            
            values.append(plugin_id)
            values.append(module_id)
            
            cursor = self.conn.cursor()
            cursor.execute(query, values)
            
            self.conn.commit()
            return True
        except sqlite3.Error as e:
            self.conn.rollback()
            logger.error("Error updating module", 
                        plugin_id=plugin_id, 
                        module_id=module_id, 
                        error=str(e))
            raise
            
    def delete_plugin(self, plugin_id: str) -> bool:
        """Delete a plugin and all its modules."""
        try:
            # Check if plugin exists
            existing_plugin = self.get_plugin(plugin_id)
            if not existing_plugin:
                logger.warning("Plugin not found for deletion", plugin_id=plugin_id)
                return False
            
            cursor = self.conn.cursor()
            cursor.execute('''
            DELETE FROM plugins WHERE id = ?
            ''', (plugin_id,))
            
            # Modules will be automatically deleted due to ON DELETE CASCADE
            
            self.conn.commit()
            return True
        except sqlite3.Error as e:
            self.conn.rollback()
            logger.error("Error deleting plugin", 
                        plugin_id=plugin_id, 
                        error=str(e))
            raise
            
    def delete_module(self, plugin_id: str, module_id: str) -> bool:
        """Delete a specific module from a plugin."""
        try:
            # Check if module exists
            existing_module = self.get_module(plugin_id, module_id)
            if not existing_module:
                logger.warning("Module not found for deletion", 
                              plugin_id=plugin_id, 
                              module_id=module_id)
                return False
            
            cursor = self.conn.cursor()
            cursor.execute('''
            DELETE FROM modules WHERE plugin_id = ? AND id = ?
            ''', (plugin_id, module_id))
            
            self.conn.commit()
            return True
        except sqlite3.Error as e:
            self.conn.rollback()
            logger.error("Error deleting module", 
                        plugin_id=plugin_id, 
                        module_id=module_id, 
                        error=str(e))
            raise
            
    def update_plugin_status(self, plugin_id: str, enabled: bool) -> bool:
        """Update a plugin's enabled status."""
        try:
            cursor = self.conn.cursor()
            cursor.execute('''
            UPDATE plugins
            SET enabled = ?, updated_at = datetime('now')
            WHERE id = ?
            ''', (1 if enabled else 0, plugin_id))
            
            if cursor.rowcount == 0:
                logger.warning("Plugin not found for status update", plugin_id=plugin_id)
                return False
            
            self.conn.commit()
            return True
        except sqlite3.Error as e:
            self.conn.rollback()
            logger.error("Error updating plugin status", 
                        plugin_id=plugin_id, 
                        error=str(e))
            raise
            
    def update_module_status(self, plugin_id: str, module_id: str, enabled: bool) -> bool:
        """Update a module's enabled status."""
        try:
            cursor = self.conn.cursor()
            cursor.execute('''
            UPDATE modules
            SET enabled = ?, updated_at = datetime('now')
            WHERE plugin_id = ? AND id = ?
            ''', (1 if enabled else 0, plugin_id, module_id))
            
            if cursor.rowcount == 0:
                logger.warning("Module not found for status update", 
                              plugin_id=plugin_id, 
                              module_id=module_id)
                return False
            
            self.conn.commit()
            return True
        except sqlite3.Error as e:
            self.conn.rollback()
            logger.error("Error updating module status", 
                        plugin_id=plugin_id, 
                        module_id=module_id, 
                        error=str(e))
            raise
            
    def close(self):
        """Close the database connection."""
        if self.conn:
            self.conn.close()
