import os
import zipfile
import tarfile
import tempfile
from pathlib import Path
import aiohttp
import asyncio
import logging
import structlog
import traceback
from dotenv import dotenv_values

from app.plugins.service_installler.installer_docker import install_docker_service
from backend.app.plugins.service_installler.python_manager import install_python_service
from .prerequisites import check_required_env_vars, convert_to_download_url

# Create logs directory
log_dir = Path("logs")
log_dir.mkdir(exist_ok=True)

# Configure standard logging to write to file
logging.basicConfig(
    filename=log_dir / "plugin_installer.log",
    filemode="a",
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s"
)

# Configure structlog to use the standard logging
structlog.configure(
    processors=[
        structlog.processors.TimeStamper(fmt="ISO"),
        structlog.stdlib.add_log_level,
        structlog.stdlib.ProcessorFormatter.wrap_for_formatter,
    ],
    logger_factory=structlog.stdlib.LoggerFactory(),
    cache_logger_on_first_use=True
)

logger = structlog.get_logger()

# Example usage
logger.info("Logger initialized", file=str(log_dir / "plugin_installer.log"))

async def download_and_extract_repo(session: aiohttp.ClientSession, source_url: str, target_dir: Path, max_retries: int = 3):
    """
    Download and extract a repository from various sources (GitHub, GitLab, etc.)
    Supports both zip and tar.gz formats with fallback for different branch names and retry logic
    """
    # Try different branch names in order of preference
    branch_names = ['main']
    
    for branch in branch_names:
        download_url = convert_to_download_url(source_url, branch)
        
        # Try downloading with retries
        for attempt in range(max_retries):
            try:
                logger.info(f"Attempting to download repository from {download_url} (attempt {attempt + 1}/{max_retries})")
                
                async with session.get(download_url) as response:
                    if response.status == 404 and branch != branch_names[-1]:
                        # Branch not found, try next branch
                        logger.info(f"Branch '{branch}' not found, trying next...")
                        break
                    elif response.status != 200:
                        if attempt == max_retries - 1:
                            raise RuntimeError(f"HTTP {response.status}: {response.reason}")
                        logger.warning(f"Download failed with HTTP {response.status}, retrying...")
                        await asyncio.sleep(2 ** attempt)  # Exponential backoff
                        continue
                    
                    # Get file size for progress tracking
                    file_size = response.headers.get('content-length')
                    if file_size:
                        logger.info(f"Downloading {int(file_size) / 1024 / 1024:.1f} MB...")
                    
                    # Determine file type from URL or Content-Type
                    content_type = response.headers.get('content-type', '').lower()
                    is_zip = (download_url.endswith('.zip') or 
                             'application/zip' in content_type or 
                             'application/x-zip-compressed' in content_type)
                    
                    # Download to temporary file with progress tracking
                    with tempfile.NamedTemporaryFile(suffix='.zip' if is_zip else '.tar.gz', delete=False) as temp_file:
                        temp_path = Path(temp_file.name)
                        downloaded = 0
                        
                        try:
                            async for chunk in response.content.iter_chunked(16384):  # Larger chunks
                                temp_file.write(chunk)
                                downloaded += len(chunk)
                                
                                # Log progress every 5MB
                                if downloaded % (5 * 1024 * 1024) == 0 and file_size:
                                    progress = (downloaded / int(file_size)) * 100
                                    logger.info(f"Download progress: {progress:.1f}%")
                                    
                        except Exception as e:
                            # Clean up temp file if download fails
                            temp_path.unlink(missing_ok=True)
                            raise e
                    
                    logger.info(f"Download completed ({downloaded / 1024 / 1024:.1f} MB)")
                    
                    # Successfully downloaded, now extract
                    await extract_archive(temp_path, target_dir, is_zip)
                    return  # Success, exit all loops
                    
            except (aiohttp.ClientError, asyncio.TimeoutError, OSError) as e:
                logger.warning(f"Download attempt {attempt + 1} failed: {e}")
                if attempt == max_retries - 1:
                    if branch == branch_names[-1]:
                        # Last branch and last attempt
                        raise RuntimeError(f"Failed to download repository after {max_retries} attempts: {e}")
                    # Try next branch
                    break
                # Wait before retry with exponential backoff
                await asyncio.sleep(2 ** attempt)
    
    raise RuntimeError("No valid branch found for repository download")

async def extract_archive(temp_path: Path, target_dir: Path, is_zip: bool):
    """
    Extract archive file to target directory
    """
    try:
        logger.info(f"Extracting archive to {target_dir}")
        target_dir.mkdir(parents=True, exist_ok=True)
        
        if is_zip:
            with zipfile.ZipFile(temp_path, 'r') as zip_file:
                # Extract all files
                zip_file.extractall(target_dir.parent)
                
                # Get the root directory name (usually repo-name-branch)
                root_dirs = [name for name in zip_file.namelist() if '/' in name]
                if root_dirs:
                    extracted_root = target_dir.parent / root_dirs[0].split('/')[0]
                    if extracted_root != target_dir and extracted_root.exists():
                        # Rename to target directory
                        if target_dir.exists():
                            import shutil
                            shutil.rmtree(target_dir)
                        extracted_root.rename(target_dir)
        else:
            with tarfile.open(temp_path, 'r:gz') as tar_file:
                tar_file.extractall(target_dir.parent)
                
                # Similar logic for tar files
                members = tar_file.getmembers()
                if members:
                    root_dir_name = members[0].name.split('/')[0]
                    extracted_root = target_dir.parent / root_dir_name
                    if extracted_root != target_dir and extracted_root.exists():
                        if target_dir.exists():
                            import shutil
                            shutil.rmtree(target_dir)
                        extracted_root.rename(target_dir)
                        
        logger.info(f"Successfully extracted archive to {target_dir}")
        
    finally:
        # Clean up temporary file
        temp_path.unlink(missing_ok=True)

async def install_required_services(services_runtime: list, plugin_slug: str):
    """
    Install and run required backend services for a plugin.
    Each service runs in its own venv and process.
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
                name = service["name"]
                source_url = service["source_url"]
                service_type = service.get("type", "python")

                # --- Prerequisite Check ---
                required_vars = service.get("required_env_vars", [])
                check_required_env_vars(
                    service_name=name,
                    required_vars=required_vars,
                    root_env_path=root_env_path
                )
                
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
                    await install_docker_service(service, target_dir, env_vars, required_vars)
                else:
                    raise ValueError(f"Unknown service type: {service_type}")
    except Exception as e:
        logger.error(
            f"Installation failed: {type(e).__name__}: {e}\n"
            f"Traceback:\n{traceback.format_exc()}"
        )
        raise


# Example usage:
# async def main():
#     # Python installation
#     # services = [
#     #     {
#     #         "name": "api_service",
#     #         "source_url": "https://github.com/BrainDriveAI/chat-with-your-documents",
#     #         "type": "python",
#     #         "install_command": "-m pip install -r requirements.txt",
#     #         "start_command": "-m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000",
#     #         "healthcheck_url": "http://localhost:8000/health"
#     #     }
#     # ]

#     # Docker Compose installation
#     services = [
#         {
#             "name": "api_service",
#             "source_url": "https://github.com/BrainDriveAI/chat-with-your-documents",
#             "type": "docker-compose",
#             "install_command": "",
#             "start_command": "docker compose up --build -d",
#             "healthcheck_url": "http://localhost:8000/health",
#             "required_env_vars": [
#                 "LLM_PROVIDER",
#                 "EMBEDDING_PROVIDER",
#                 "ENABLE_CONTEXTUAL_RETRIEVAL",
#                 "OLLAMA_CONTEXTUAL_LLM_BASE_URL",
#                 "OLLAMA_CONTEXTUAL_LLM_MODEL",
#                 "OLLAMA_LLM_BASE_URL",
#                 "OLLAMA_LLM_MODEL",
#                 "OLLAMA_EMBEDDING_BASE_URL",
#                 "OLLAMA_EMBEDDING_MODEL",
#                 "DOCUMENT_PROCESSOR_API_URL",
#                 "DOCUMENT_PROCESSOR_TIMEOUT",
#                 "DOCUMENT_PROCESSOR_MAX_RETRIES",
#             ]
#         }
#     ]
    
#     await install_required_services(services, "my_plugin")

# if __name__ == "__main__":
#     asyncio.run(main())
