import json
import os
import threading
from app.core.config import settings

class JSONStorage:
    _lock = threading.Lock()

    def __init__(self, filename=settings.JSON_DB_PATH):
        self.filename = filename
        self.data = self._load_data()

    def _load_data(self):
        """Load database.json, or create a new file if it doesn't exist."""
        if os.path.exists(self.filename):
            with open(self.filename, "r") as file:
                return json.load(file)
        return {"users": [], "tenants": [], "roles": [], "permissions": []}

    def save_data(self):
        """Safely write to database.json using a lock."""
        with self._lock:
            with open(self.filename, "w") as file:
                json.dump(self.data, file, indent=4)

    def insert(self, table, record, unique_field=None):
        """Insert a record safely while enforcing unique constraints."""
        with self._lock:
            if unique_field and any(item.get(unique_field) == record[unique_field] for item in self.data.get(table, [])):
                raise ValueError(f"Duplicate {unique_field}: {record[unique_field]}")

            self.data[table].append(record)
            self.save_data()

    def insert_with_relationship(self, table, record, related_table=None, foreign_key=None):
        """Insert a record and validate foreign key references."""
        with self._lock:
            if related_table and foreign_key:
                related_ids = {item["id"] for item in self.data.get(related_table, [])}
                if record[foreign_key] not in related_ids:
                    raise ValueError(f"Invalid foreign key {foreign_key}: {record[foreign_key]} does not exist in {related_table}")

            self.insert(table, record)

    def get_all(self, table):
        """Retrieve all records from a given table."""
        with self._lock:
            return self.data.get(table, [])

    def get_by_id(self, table, record_id):
        """Retrieve a single record by ID."""
        with self._lock:
            return next((item for item in self.data.get(table, []) if item["id"] == record_id), None)

    def exists(self, table, **filters):
        """Check if a record exists based on filters."""
        with self._lock:
            return any(all(item.get(k) == v for k, v in filters.items()) for item in self.data.get(table, []))

    def delete(self, table, record_id):
        """Delete a record by ID."""
        with self._lock:
            self.data[table] = [item for item in self.data[table] if item["id"] != record_id]
            self.save_data()

    def filter(self, table, **filters):
        """Retrieve records matching filters."""
        with self._lock:
            return [
                item for item in self.data.get(table, [])
                if all(item.get(k) == v for k, v in filters.items())
            ]

json_db = JSONStorage()
