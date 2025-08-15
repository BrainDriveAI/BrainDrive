import os
import structlog
from pathlib import Path
from dotenv import dotenv_values

logger = structlog.get_logger()

def load_env_vars(env_path: Path):
    """
    Loads environment variables from a .env file and returns them as a dictionary.
    """
    if not env_path.exists():
        logger.warning(f"Root .env file not found at {env_path}")
        return {}
    
    try:
        # dotenv_values() is a good way to read the file without modifying os.environ
        # for a quick check.
        env_vars = dotenv_values(env_path)
        return env_vars
    except Exception as e:
        logger.error(f"Failed to load .env file from {env_path}: {e}")
        return {}


def check_required_env_vars(service_name: str, required_vars: list, root_env_path: Path):
    """
    Checks if all required environment variables are set in the root .env file.
    
    Args:
        service_name: The name of the service being installed.
        required_vars: A list of environment variable names.
        root_env_path: The path to the main .env file.
    
    Raises:
        RuntimeError: If any required variable is missing.
    """
    # Load the variables from the root .env file
    env_vars = load_env_vars(root_env_path)
    
    missing_vars = [var for var in required_vars if var not in env_vars or not env_vars[var]]

    if missing_vars:
        logger.error(
            "Missing required environment variables in .env file",
            service=service_name,
            missing_vars=missing_vars
        )
        raise RuntimeError(
            f"Missing required environment variables for service '{service_name}': "
            f"{', '.join(missing_vars)}. Please add them to your main BrainDrive backend .env file at {root_env_path}."
        )

    logger.info("All required environment variables are present.")


def write_env_file(target_dir: Path, env_vars: dict, required_vars: list):
    """
    Creates a .env file in the target directory by reading values from a given dictionary.
    
    Args:
        target_dir: The directory where the .env file will be created.
        env_vars: A dictionary of all available environment variables.
        required_vars: A list of the specific variables to write to the new .env file.
    """
    env_path = target_dir / ".env"
    
    try:
        logger.info(f"Creating .env file for service at {env_path}")
        with open(env_path, "w") as f:
            for var_name in required_vars:
                var_value = env_vars.get(var_name, "")
                f.write(f"{var_name}={var_value}\n")
    except Exception as e:
        logger.error(f"Failed to create .env file for service: {e}")
        raise RuntimeError(f"Failed to create .env file for service: {e}")

