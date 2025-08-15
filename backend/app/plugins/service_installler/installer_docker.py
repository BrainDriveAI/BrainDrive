import subprocess
from pathlib import Path
import structlog
import asyncio
from typing import Dict, List
from .service_health_checker import wait_for_service_health
from .prerequisites import write_env_file

logger = structlog.get_logger()

async def run_docker_compose_command(command: str, cwd: Path):
    """
    Run a docker compose command in a background thread and log its output.
    Works cross-platform, even in environments where asyncio subprocess isn't supported.
    """
    logger.info(f"Running docker compose command: {command} in '{cwd}'")
    
    def _run():
        return subprocess.run(command, shell=True, cwd=str(cwd), capture_output=True, text=True)
    
    try:
        # Use asyncio.to_thread if available (Python 3.9+), otherwise use run_in_executor
        if hasattr(asyncio, 'to_thread'):
            result = await asyncio.to_thread(_run)
        else:
            loop = asyncio.get_event_loop()
            result = await loop.run_in_executor(None, _run)
            
        if result.returncode != 0:
            logger.error("Docker compose command failed", stdout=result.stdout, stderr=result.stderr)
            raise RuntimeError(f"Docker compose failed:\n{result.stderr}")
        logger.info(f"Docker compose completed successfully:\n{result.stdout}")
        
    except Exception as e:
        logger.error(f"Failed to run docker compose command: {e}")
        raise RuntimeError(f"Failed to run docker compose command: {e}")

async def check_docker_simple():
    """
    Simple Docker check using shell commands to avoid DLL issues
    """
    logger.info("Checking Docker availability...")
    
    def _check_docker():
        try:
            # Test docker command
            docker_result = subprocess.run(
                "docker --version", 
                shell=True, 
                capture_output=True, 
                text=True, 
                timeout=10
            )
            if docker_result.returncode != 0:
                return False, f"Docker command failed: {docker_result.stderr}"
            
            # Test docker compose
            compose_result = subprocess.run(
                "docker compose version", 
                shell=True, 
                capture_output=True, 
                text=True, 
                timeout=10
            )
            if compose_result.returncode != 0:
                return False, f"Docker Compose command failed: {compose_result.stderr}"
            
            # Test docker daemon
            daemon_result = subprocess.run(
                "docker info", 
                shell=True, 
                capture_output=True, 
                text=True, 
                timeout=15
            )
            if daemon_result.returncode != 0:
                return False, f"Docker daemon not running: {daemon_result.stderr}"
            
            return True, "Docker is available and running"
            
        except Exception as e:
            return False, f"Docker check failed: {str(e)}"
    
    # Run the check in a thread
    if hasattr(asyncio, 'to_thread'):
        return await asyncio.to_thread(_check_docker)
    else:
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, _check_docker)

async def install_docker_service(
    service_data: dict, 
    target_dir: Path,
    env_vars: Dict[str, str],
    required_vars: List[str]
):
    """
    Handle the installation and startup of a service using Docker Compose.
    """
    # Check Docker availability using shell commands
    is_available, message = await check_docker_simple()
    if not is_available:
        raise RuntimeError(
            f"Docker is not available: {message}\n\n"
            "Please ensure:\n"
            "1. Docker Desktop is installed and running\n"
            "2. Docker commands work from your terminal\n"
            "3. Your conda environment has access to Docker\n"
            "4. Try restarting your terminal/IDE after installing Docker"
        )
    
    logger.info(f"Docker check passed: {message}")
    
    start_command = service_data.get("start_command")
    healthcheck_url = service_data.get("healthcheck_url")
    
    if not start_command:
        raise ValueError("Missing 'start_command' for docker service")
    
    # Write environment file
    write_env_file(target_dir, env_vars, required_vars)
    
    # Run the Docker Compose start command
    await run_docker_compose_command(start_command, target_dir)
    
    # Wait for the service to be healthy
    if healthcheck_url:
        logger.info(f"Waiting for Docker service to become healthy at {healthcheck_url}...")
        if await wait_for_service_health(healthcheck_url):
            logger.info("Docker service is healthy.")
        else:
            await run_docker_compose_command("docker compose down", target_dir)
            raise RuntimeError("Docker service failed to become healthy within the timeout period.")
    else:
        logger.info("No healthcheck URL provided, assuming service started successfully")
