import time
import aiohttp
import asyncio

async def wait_for_service_health(healthcheck_url: str, timeout: int = 100) -> bool:
    """
    Wait for a service to become healthy using async HTTP requests
    """
    start_time = time.time()
    
    async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=2)) as session:
        while time.time() - start_time < timeout:
            try:
                async with session.get(healthcheck_url) as response:
                    if response.status == 200:
                        return True
            except (aiohttp.ClientError, asyncio.TimeoutError):
                pass
            
            await asyncio.sleep(1)
    
    return False
