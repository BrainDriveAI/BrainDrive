import os
import zipfile
import tarfile
import tempfile
import aiohttp
import asyncio
from pathlib import Path
from typing import List, Dict
import structlog
import shutil
from dotenv import dotenv_values

from app.plugins.service_installler.docker_manager import install_and_start_docker_service, stop_docker_service
from app.plugins.service_installler.python_manager import install_python_service
from .prerequisites import check_required_env_vars, convert_to_download_url

logger = structlog.get_logger()

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
    
    # Ensure target directory is clean and ready
    if target_dir.exists():
        shutil.rmtree(target_dir)
    target_dir.mkdir(parents=True, exist_ok=True)

    try:
        if is_zip:
            with zipfile.ZipFile(temp_path, 'r') as zip_file:
                zip_file.extractall(target_dir.parent)
                # Find and rename the extracted directory (e.g., repo-main)
                # This is a common pattern for GitHub/GitLab zip archives
                first_dir = [name for name in zip_file.namelist() if '/' in name][0].split('/')[0]
                shutil.move(target_dir.parent / first_dir, target_dir)
        else:
            with tarfile.open(temp_path, 'r:gz') as tar_file:
                tar_file.extractall(target_dir.parent)
                first_dir = tar_file.getmembers()[0].name.split('/')[0]
                shutil.move(target_dir.parent / first_dir, target_dir)
                
    except (zipfile.BadZipFile, tarfile.TarError) as e:
        logger.error("Archive extraction failed", error=str(e))
        raise RuntimeError(f"Failed to extract archive: {e}")


async def install_plugin_service(service_data: dict, plugin_slug: str):
    """
    Installs a single plugin service, including downloading the source
    and starting the service. This function is for first-time installation.
    """
    base_services_dir = Path("services_runtime")
    base_services_dir.mkdir(parents=True, exist_ok=True)
    target_dir = base_services_dir / f"{plugin_slug}_{service_data['name']}"
    
    if target_dir.exists():
        logger.info("Service directory already exists, skipping installation", path=str(target_dir))
    else:
        # Download and extract the service source code
        env_vars = dotenv_values(Path(os.getcwd()) / ".env")
        timeout = aiohttp.ClientTimeout(total=300)
        connector = aiohttp.TCPConnector(limit=10)
        
        try:
            async with aiohttp.ClientSession(timeout=timeout, connector=connector) as session:
                await download_and_extract_repo(session, service_data["source_url"], target_dir)
        except Exception as e:
            logger.error("Failed to download or extract repository", error=str(e))
            raise RuntimeError(f"Failed to download repository for service {service_data['name']}: {e}")

    # Dispatch to the appropriate installer/runner
    service_type = service_data.get("type", "python")
    required_vars = service_data.get("required_env_vars", [])
    
    # Prerequisite Check
    check_required_env_vars(
        service_name=service_data['name'],
        required_vars=required_vars,
        root_env_path=Path(os.getcwd()) / ".env"
    )
    
    if service_type == 'python':
        await install_python_service(service_data, target_dir)
    elif service_type == 'docker-compose':
        await install_and_start_docker_service(service_data, target_dir, dotenv_values(Path(os.getcwd()) / ".env"), required_vars)
    else:
        raise ValueError(f"Unknown service type: {service_type}")


async def start_plugin_services(services_runtime: List[Dict], plugin_slug: str):
    """
    Starts a list of plugin services. This is used on application startup
    and assumes the code is already downloaded.
    """
    logger.info("Starting required plugin services")
    
    for service_data in services_runtime:
        target_dir = Path("services_runtime") / f"{plugin_slug}_{service_data['name']}"
        service_type = service_data.get("type", "python")
        
        try:
            logger.info("Attempting to start service", name=service_data['name'])
            if service_type == 'docker-compose':
                # The start_command is the same as the install command for docker
                await install_and_start_docker_service(
                    service_data,
                    target_dir,
                    dotenv_values(Path(os.getcwd()) / ".env"),
                    service_data.get('required_env_vars', [])
                )
            elif service_type == 'python':
                # Assuming install_python_service can handle a pre-existing venv
                await install_python_service(service_data, target_dir)
            else:
                logger.warning("Skipping unknown service type", type=service_type, name=service_data['name'])
                
        except Exception as e:
            logger.error("Failed to start service", name=service_data['name'], error=str(e))
            # Continue to the next service even if one fails
            continue


async def stop_plugin_services(services_runtime: List[Dict], plugin_slug: str):
    """
    Stops a list of plugin services. This is used on application shotdown.
    """
    logger.info("Stopping required plugin services")
    for service_data in services_runtime:
        target_dir = Path("services_runtime") / f"{plugin_slug}_{service_data['name']}"
        service_type = service_data.get("type", "python")
        
        try:
            logger.info("Attempting to stop service", name=service_data['name'])
            if service_type == 'docker-compose':
                # The start_command is the same as the install command for docker
                await stop_docker_service(
                    service_data,
                    target_dir,
                )
            else:
                logger.warning("Skipping unknown service type", type=service_type, name=service_data['name'])
                
        except Exception as e:
            logger.error("Failed to stop service", name=service_data['name'], error=str(e))
            # Continue to the next service even if one fails
            continue
