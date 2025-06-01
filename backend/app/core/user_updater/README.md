# User Update System

This module provides a simple framework for applying data migrations when a user logs in. Update steps can be defined by the core system or by plugins.

## Overview

* Updaters are discovered automatically from `app.core.user_updater.updaters` and from plugin packages.
* Each updater inherits from `UserUpdaterBase` and registers itself using `register_updater`.
* Updaters specify the version they migrate **from** and **to** using `from_version` and `to_version`.
* During login the system checks the user's current `version` field and runs any pending updaters in order.

## Creating an Updater

1. Create a class that inherits from `UserUpdaterBase`.
2. Set the `name`, `from_version` and `to_version` attributes.
3. Implement the `apply` method (and optionally `rollback`).
4. Register the updater with `register_updater`.

Example:

```python
from app.core.user_updater.base import UserUpdaterBase
from app.core.user_updater.registry import register_updater

class ExampleUpdater(UserUpdaterBase):
    name = "example_updater"
    from_version = "0.0.0"
    to_version = "0.1.0"

    async def apply(self, user_id: str, db, **kwargs) -> bool:
        # perform migration logic
        return True

register_updater(ExampleUpdater)
```

When the application starts, `discover_all_updaters()` loads all updaters so they are available during login.

