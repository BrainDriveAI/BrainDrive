import os
import zipfile
import tarfile
import tempfile
import aiohttp
import asyncio
from pathlib import Path
from typing import List, Dict, Union
import structlog
import shutil
import traceback
from dotenv import dotenv_values

from app.dto.plugin import PluginServiceRuntimeDTO
from app.plugins.service_installler.docker_manager import (
    build_and_start_docker_service,
    restart_docker_service,
    stop_docker_service,
)
from app.plugins.service_installler.python_manager import install_python_service
from .prerequisites import check_required_env_vars, convert_to_download_url

from app.plugins.repository import PluginRepository
from app.core.database import get_db

logger = structlog.get_logger()

def ensure_service_dto(
    service_data: Union[Dict, PluginServiceRuntimeDTO], 
    plugin_id: str = None, 
    plugin_slug: str = None, 
    user_id: str = None
) -> PluginServiceRuntimeDTO:
    """
    Ensures the service data is a DTO, converting from dict if necessary.
    """
    return PluginServiceRuntimeDTO.from_dict_or_dto(service_data, plugin_id, plugin_slug, user_id)


async def install_and_run_required_services(
    services_runtime: list[dict],
    plugin_slug: str,
    plugin_id: str = None,
    user_id: str = None
):
    """
    Install and run required backend services for a plugin.
    Each service runs in its own venv and process.
    
    Args:
        services_runtime: List of service configurations (dicts from GitHub or DTOs from DB)
        plugin_slug: The plugin identifier slug
        plugin_id: Plugin ID (required when services_runtime contains dicts)
        user_id: User ID (required when services_runtime contains dicts)
    """
    base_services_dir = Path("services_runtime")
    base_services_dir.mkdir(parents=True, exist_ok=True)

    # Define the path to the root .env file
    root_env_path = Path(os.getcwd()) / ".env"
    
    # Load the environment variables from the root .env file once
    env_vars = dotenv_values(root_env_path)
    
    # Configure session with longer timeouts and connection limits
    timeout = aiohttp.ClientTimeout(
        total=300,  # 5 minutes total
        connect=30,  # 30 seconds to connect
        sock_read=60  # 60 seconds for reading data
    )
    
    connector = aiohttp.TCPConnector(
        limit=10,
        limit_per_host=5,
        ttl_dns_cache=300,
        use_dns_cache=True
    )

    logger.info("Starting installation of required services")
    
    try:
        async with aiohttp.ClientSession(timeout=timeout, connector=connector) as session:
            for service in services_runtime:
                # Convert to DTO if it's a dict (first install from GitHub)
                service_dto = ensure_service_dto(service, plugin_id, plugin_slug, user_id)

                name = service_dto.name
                source_url = service_dto.source_url
                service_type = service_dto.type
                required_vars = service_dto.required_env_vars
                
                target_dir = base_services_dir / f"{plugin_slug}_{name}"
                
                # Download and extract repository
                if target_dir.exists():
                    logger.info(f"Service directory already exists: {target_dir}, skipping download.")
                else:
                    try:
                        await download_and_extract_repo(session, source_url, target_dir)
                        logger.info(f"Successfully downloaded and extracted {source_url} to {target_dir}")
                    except Exception as e:
                        logger.error(f"Failed to download repository {source_url}: {e}")
                        raise RuntimeError(f"Failed to download repository for service {name}: {e}")
                
                # Dispatch to the appropriate installer based on service type
                if service_type == 'python':
                    await install_python_service(service, target_dir)
                elif service_type == 'docker-compose':
                    await build_and_start_docker_service(service_dto, target_dir, env_vars, required_vars)
                else:
                    raise ValueError(f"Unknown service type: {service_type}")
    except Exception as e:
        logger.error(
            f"Installation failed: {type(e).__name__}: {e}\n"
            f"Traceback:\n{traceback.format_exc()}"
        )
        raise


async def download_and_extract_repo(session: aiohttp.ClientSession, source_url: str, target_dir: Path, max_retries: int = 3):
    """
    Download and extract a repository from a git URL.
    """
    download_url = convert_to_download_url(source_url)
    
    for attempt in range(max_retries):
        try:
            logger.info("Attempting to download repository", url=download_url, attempt=attempt + 1)
            async with session.get(download_url) as response:
                response.raise_for_status() # Raises for 4xx/5xx responses
                
                content_type = response.headers.get('content-type', '').lower()
                is_zip = 'zip' in content_type or download_url.endswith('.zip')
                
                with tempfile.NamedTemporaryFile(suffix='.zip' if is_zip else '.tar.gz', delete=False) as temp_file:
                    temp_path = Path(temp_file.name)
                    async for chunk in response.content.iter_chunked(16384):
                        temp_file.write(chunk)
                
                await _extract_archive(temp_path, target_dir, is_zip)
                return
        except (aiohttp.ClientError, asyncio.TimeoutError) as e:
            logger.warning("Download failed, retrying...", error=str(e), attempt=attempt + 1)
            await asyncio.sleep(2 ** attempt)
        finally:
            # Clean up temp file
            if 'temp_path' in locals() and temp_path.exists():
                temp_path.unlink(missing_ok=True)
                
    raise RuntimeError(f"Failed to download repository from {source_url} after {max_retries} attempts.")


async def _extract_archive(temp_path: Path, target_dir: Path, is_zip: bool):
    """
    Extracts a zip or tar.gz archive.
    """
    logger.info("Extracting archive", path=str(temp_path), target=str(target_dir))
    
    # Ensure target directory parent exists
    target_dir.parent.mkdir(parents=True, exist_ok=True)
    
    # Create a temporary extraction directory
    temp_extract_dir = target_dir.parent / f"temp_extract_{target_dir.name}"
    if temp_extract_dir.exists():
        shutil.rmtree(temp_extract_dir)
    temp_extract_dir.mkdir(exist_ok=True)
    
    try:
        if is_zip:
            with zipfile.ZipFile(temp_path, 'r') as zip_file:
                zip_file.extractall(temp_extract_dir)
                # Find the first directory (e.g., repo-main)
                extracted_items = list(temp_extract_dir.iterdir())
                if len(extracted_items) == 1 and extracted_items[0].is_dir():
                    # Single directory case - move its contents
                    extracted_dir = extracted_items[0]
                    if target_dir.exists():
                        shutil.rmtree(target_dir)
                    shutil.move(str(extracted_dir), str(target_dir))
                else:
                    # Multiple items or files - move temp_extract_dir to target
                    if target_dir.exists():
                        shutil.rmtree(target_dir)
                    shutil.move(str(temp_extract_dir), str(target_dir))
                    temp_extract_dir = None  # Prevent cleanup since it's been moved
        else:
            with tarfile.open(temp_path, 'r:gz') as tar_file:
                tar_file.extractall(temp_extract_dir)
                # Find the first directory
                extracted_items = list(temp_extract_dir.iterdir())
                if len(extracted_items) == 1 and extracted_items[0].is_dir():
                    # Single directory case - move its contents
                    extracted_dir = extracted_items[0]
                    if target_dir.exists():
                        shutil.rmtree(target_dir)
                    shutil.move(str(extracted_dir), str(target_dir))
                else:
                    # Multiple items or files - move temp_extract_dir to target
                    if target_dir.exists():
                        shutil.rmtree(target_dir)
                    shutil.move(str(temp_extract_dir), str(target_dir))
                    temp_extract_dir = None  # Prevent cleanup since it's been moved
                
    except (zipfile.BadZipFile, tarfile.TarError) as e:
        logger.error("Archive extraction failed", error=str(e))
        raise RuntimeError(f"Failed to extract archive: {e}")
    finally:
        # Clean up temp extraction directory if it still exists
        if temp_extract_dir and temp_extract_dir.exists():
            shutil.rmtree(temp_extract_dir)


async def install_plugin_service(service_data: PluginServiceRuntimeDTO, plugin_slug: str):
    """
    Installs a single plugin service, including downloading the source
    and starting the service. This function is for first-time installation.
    """
    base_services_dir = Path("services_runtime")
    base_services_dir.mkdir(parents=True, exist_ok=True)
    target_dir = base_services_dir / f"{plugin_slug}_{service_data.name}"
    
    if target_dir.exists():
        logger.info("Service directory already exists, skipping installation", path=str(target_dir))
    else:
        # Download and extract the service source code
        env_vars = dotenv_values(Path(os.getcwd()) / ".env")
        timeout = aiohttp.ClientTimeout(total=300)
        connector = aiohttp.TCPConnector(limit=10)
        
        try:
            async with aiohttp.ClientSession(timeout=timeout, connector=connector) as session:
                await download_and_extract_repo(session, service_data.source_url, target_dir)
        except Exception as e:
            logger.error("Failed to download or extract repository", error=str(e))
            raise RuntimeError(f"Failed to download repository for service {service_data.name}: {e}")

    # Dispatch to the appropriate installer/runner
    service_type = service_data.type or "docker-compose"
    required_vars = service_data.required_env_vars or []
    
    # Prerequisite Check
    # check_required_env_vars(
    #     service_name=service_data.name,
    #     required_vars=required_vars,
    #     root_env_path=Path(os.getcwd()) / ".env"
    # )
    
    if service_type == 'python':
        await install_python_service(service_data, target_dir)
    elif service_type == 'docker-compose':
        await build_and_start_docker_service(service_data, target_dir, dotenv_values(Path(os.getcwd()) / ".env"), required_vars)
    else:
        raise ValueError(f"Unknown service type: {service_type}")


async def start_plugin_services(services_runtime: List[PluginServiceRuntimeDTO], plugin_slug: str):
    """
    Starts a list of plugin services. This is used on application startup
    and assumes the code is already downloaded.
    """
    logger.info("Starting required plugin services")
    
    for service_data in services_runtime:
        target_dir = Path("services_runtime") / f"{plugin_slug}_{service_data.name}"
        service_type = service_data.type or "docker-compose"
        
        try:
            logger.info("Attempting to start service", name=service_data.name)
            if service_type == 'docker-compose':
                # The start_command is the same as the install command for docker
                await build_and_start_docker_service(
                    service_data,
                    target_dir,
                    dotenv_values(Path(os.getcwd()) / ".env"),
                    service_data.required_env_vars or []
                )
            elif service_type == 'python':
                # Assuming install_python_service can handle a pre-existing venv
                await install_python_service(service_data, target_dir)
            else:
                logger.warning("Skipping unknown service type", type=service_type, name=service_data.name)
                
        except Exception as e:
            logger.error("Failed to start service", name=service_data.name, error=str(e))
            # Continue to the next service even if one fails
            continue


async def stop_plugin_services(services_runtime: List[PluginServiceRuntimeDTO], plugin_slug: str):
    """
    Stops a list of plugin services. This is used on application shotdown.
    """
    logger.info("Stopping required plugin services")
    for service_data in services_runtime:
        target_dir = Path("services_runtime") / f"{plugin_slug}_{service_data.name}"
        service_type = service_data.type or "docker-compose"
        
        try:
            logger.info("Attempting to stop service", name=service_data.name)
            if service_type == 'docker-compose':
                # The start_command is the same as the install command for docker
                await stop_docker_service(
                    service_data,
                    target_dir,
                )
            else:
                logger.warning("Skipping unknown service type", type=service_type, name=service_data.name)
                
        except Exception as e:
            logger.error("Failed to stop service", name=service_data.name, error=str(e))
            # Continue to the next service even if one fails
            continue


async def restart_plugin_services(plugin_slug: str, definition_id: str, user_id: str = None, service_name: str = None):
    """
    Restart one or all services for a given plugin, using env vars from DB (not .env file).
    """
    async for db in get_db():
        repo = PluginRepository(db)

        # Get plugin id
        plugin_data = await repo.get_plugin_by_slug(plugin_slug, user_id)

        if not plugin_data:
            # Raise a standard Python exception instead of HTTPException
            raise ValueError(f"Plugin {plugin_slug} not found")

        # Extract plugin ID
        plugin_id = plugin_data["id"]

        # Get all service runtimes for this plugin
        service_runtimes = await repo.get_service_runtimes_by_plugin_id(plugin_id)
        if not service_runtimes:
            raise RuntimeError(f"No services found for plugin {plugin_id}")

        # Get environment variables for this plugin's settings instance
        env_vars = await repo.get_settings_env_vars(definition_id, user_id) or {}

        results = {}
        for service_runtime in service_runtimes:
            if service_name and service_runtime.name != service_name:
                continue

            target_dir = Path("services_runtime") / f"{service_runtime.plugin_slug}_{service_runtime.name}"
            service_type = service_runtime.type or "docker-compose"

            try:
                # stop first
                if service_type == "docker-compose":
                    logger.info(f"Stopping existing Docker service: {service_runtime.name}")
                    await stop_docker_service(service_runtime, target_dir)
                    await restart_docker_service(
                        service_runtime,
                        target_dir,
                        env_vars,
                        service_runtime.required_env_vars or []
                    )
                elif service_type == "python":
                    # implement restart logic for python service
                    # (stop old process if tracked, then install/start again)
                    await install_python_service(service_runtime, target_dir)
                results[service_runtime.name] = "restarted"
            except Exception as e:
                results[service_runtime.name] = f"failed: {str(e)}"

        return results
