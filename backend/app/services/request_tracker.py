"""
Request tracking service for managing active AI generation requests.
"""
import asyncio
import logging
from typing import Dict, Any, Optional
from datetime import datetime, timedelta
import weakref

logger = logging.getLogger(__name__)


class RequestTracker:
    """Tracks active AI generation requests for cancellation."""
    
    def __init__(self):
        self.active_requests: Dict[str, Dict[str, Any]] = {}
        self.request_timeouts: Dict[str, asyncio.Task] = {}
        self._cleanup_task: Optional[asyncio.Task] = None
        self._start_cleanup()
    
    def _start_cleanup(self):
        """Start the cleanup task for expired requests."""
        if self._cleanup_task is None or self._cleanup_task.done():
            self._cleanup_task = asyncio.create_task(self._cleanup_loop())
    
    async def _cleanup_loop(self):
        """Periodically clean up expired requests."""
        while True:
            try:
                await asyncio.sleep(60)  # Clean up every minute
                await self._cleanup_expired_requests()
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Error in cleanup loop: {e}")
    
    async def _cleanup_expired_requests(self):
        """Remove requests that have been active for too long."""
        current_time = datetime.now()
        expired_requests = []
        
        for req_id, request_info in self.active_requests.items():
            created_time = request_info.get('created_at')
            if created_time and (current_time - created_time) > timedelta(hours=1):
                expired_requests.append(req_id)
        
        for req_id in expired_requests:
            await self.cancel_request(req_id, "Request expired")
            logger.info(f"Cleaned up expired request: {req_id}")
    
    def register_request(self, conversation_id: str, request_type: str = "chat", **kwargs) -> str:
        """Register a new active request."""
        import uuid
        request_id = str(uuid.uuid4())
        
        self.active_requests[request_id] = {
            'conversation_id': conversation_id,
            'request_type': request_type,
            'created_at': datetime.now(),
            'status': 'active',
            'kwargs': kwargs
        }
        
        logger.info(f"Registered request {request_id} for conversation {conversation_id}")
        return request_id
    
    def get_request_by_conversation(self, conversation_id: str) -> Optional[str]:
        """Get request ID by conversation ID."""
        for req_id, request_info in self.active_requests.items():
            if (request_info.get('conversation_id') == conversation_id and 
                request_info.get('status') == 'active'):
                return req_id
        return None
    
    def update_request_status(self, request_id: str, status: str, **kwargs):
        """Update the status of a request."""
        if request_id in self.active_requests:
            self.active_requests[request_id]['status'] = status
            self.active_requests[request_id].update(kwargs)
            logger.debug(f"Updated request {request_id} status to {status}")
    
    async def cancel_request(self, request_id: str, reason: str = "User cancelled") -> bool:
        """Cancel a specific request by ID."""
        if request_id in self.active_requests:
            request_info = self.active_requests[request_id]
            request_info['status'] = 'cancelled'
            request_info['cancelled_at'] = datetime.now()
            request_info['cancel_reason'] = reason
            
            # Cancel any associated tasks
            if 'task' in request_info and not request_info['task'].done():
                request_info['task'].cancel()
                try:
                    await request_info['task']
                except asyncio.CancelledError:
                    pass
            
            logger.info(f"Cancelled request {request_id}: {reason}")
            return True
        return False
    
    async def cancel_conversation_requests(self, conversation_id: str, reason: str = "User cancelled") -> bool:
        """Cancel all requests for a specific conversation."""
        cancelled = False
        request_ids = []
        
        # Find all active requests for this conversation
        for req_id, request_info in self.active_requests.items():
            if (request_info.get('conversation_id') == conversation_id and 
                request_info.get('status') == 'active'):
                request_ids.append(req_id)
        
        # Cancel each request
        for req_id in request_ids:
            if await self.cancel_request(req_id, reason):
                cancelled = True
        
        return cancelled
    
    def get_active_requests_count(self) -> int:
        """Get the count of currently active requests."""
        return len([req for req in self.active_requests.values() if req.get('status') == 'active'])
    
    def cleanup_request(self, request_id: str):
        """Remove a request from tracking (called when request completes)."""
        if request_id in self.active_requests:
            del self.active_requests[request_id]
            logger.debug(f"Cleaned up completed request: {request_id}")
    
    async def shutdown(self):
        """Shutdown the request tracker."""
        if self._cleanup_task and not self._cleanup_task.done():
            self._cleanup_task.cancel()
            try:
                await self._cleanup_task
            except asyncio.CancelledError:
                pass
        
        # Cancel all active requests
        active_request_ids = list(self.active_requests.keys())
        for req_id in active_request_ids:
            await self.cancel_request(req_id, "Service shutdown")


# Global instance
request_tracker = RequestTracker()
