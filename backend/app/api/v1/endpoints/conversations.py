"""
API endpoints for conversations and messages.
"""
import uuid
from fastapi import APIRouter, HTTPException, Depends, Query, Path, Body
from sqlalchemy.ext.asyncio import AsyncSession
from typing import List, Optional
from uuid import UUID

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.conversation import Conversation
from app.models.message import Message
from app.schemas.conversation_schemas import (
    Conversation as ConversationSchema,
    ConversationCreate,
    ConversationUpdate,
    ConversationWithMessages,
    ConversationWithPersona,
    Message as MessageSchema,
    MessageCreate
)

router = APIRouter()


@router.get("/users/{user_id}/conversations", response_model=List[ConversationSchema])
async def get_user_conversations(
    user_id: str,
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    tag_id: Optional[str] = Query(None, description="Filter by tag ID"),
    conversation_type: Optional[str] = Query(None, description="Filter by conversation type"),
    page_id: Optional[str] = Query(None, description="Filter by page ID"),
    persona_id: Optional[str] = Query(None, description="Filter by persona ID"),
    db: AsyncSession = Depends(get_db),
    current_user = Depends(get_current_user)
):
    """Get all conversations for a specific user."""
    # Format user_id to ensure consistency (remove dashes if present)
    formatted_user_id = user_id.replace('-', '')
    current_user_id = str(current_user.id).replace('-', '')
    
    # Ensure the current user can only access their own conversations
    if current_user_id != formatted_user_id:
        raise HTTPException(status_code=403, detail="Not authorized to access these conversations")
    
    # Base query
    from sqlalchemy import select
    from app.models.tag import ConversationTag
    
    query = select(Conversation).where(Conversation.user_id == formatted_user_id)
    
    # Filter by page_id if provided
    if page_id:
        query = query.where(Conversation.page_id == page_id)
    
    # Filter by tag if provided
    if tag_id:
        query = query.join(
            ConversationTag,
            ConversationTag.conversation_id == Conversation.id
        ).where(ConversationTag.tag_id == tag_id)
    
    # Filter by conversation_type if provided
    if conversation_type:
        query = query.where(Conversation.conversation_type == conversation_type)
    
    # Filter by persona_id if provided
    if persona_id:
        query = query.where(Conversation.persona_id == persona_id)
    
    # Add pagination
    query = query.order_by(Conversation.updated_at.desc()).offset(skip).limit(limit)
    
    result = await db.execute(query)
    conversations = result.scalars().all()
    
    # Get tags for each conversation
    conversation_with_tags = []
    for conversation in conversations:
        tags = await conversation.get_tags(db)
        conversation_with_tags.append({
            **conversation.__dict__,
            "tags": tags
        })
    
    return conversation_with_tags


@router.post("/conversations", response_model=ConversationSchema)
async def create_conversation(
    conversation: ConversationCreate,
    db: AsyncSession = Depends(get_db),
    current_user = Depends(get_current_user)
):
    """Create a new conversation."""
    # Ensure the current user can only create conversations for themselves
    # Format user IDs to ensure consistency (remove dashes if present)
    current_user_id = str(current_user.id).replace('-', '')
    conversation_user_id = str(conversation.user_id).replace('-', '')
    
    if current_user_id != conversation_user_id:
        raise HTTPException(status_code=403, detail="Not authorized to create conversations for this user")
    
    db_conversation = Conversation(
        id=str(uuid.uuid4()),  # Generate ID with dashes
        user_id=conversation_user_id,  # Use formatted user ID
        title=conversation.title,
        page_context=conversation.page_context,
        page_id=conversation.page_id,  # NEW FIELD
        model=conversation.model,
        server=conversation.server,
        conversation_type=conversation.conversation_type or "chat",  # New field with default
        persona_id=conversation.persona_id  # Add persona_id support
    )
    db.add(db_conversation)
    await db.commit()
    await db.refresh(db_conversation)
    return db_conversation


@router.get("/conversations/{conversation_id}", response_model=ConversationSchema)
async def get_conversation(
    conversation_id: str,
    db: AsyncSession = Depends(get_db),
    current_user = Depends(get_current_user)
):
    """Get a specific conversation."""
    conversation = await Conversation.get_by_id(db, conversation_id)
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")
    
    # Ensure the current user can only access their own conversations
    # Format user IDs to ensure consistency (remove dashes if present)
    conversation_user_id = str(conversation.user_id).replace('-', '')
    current_user_id = str(current_user.id).replace('-', '')
    
    if conversation_user_id != current_user_id:
        raise HTTPException(status_code=403, detail="Not authorized to access this conversation")
    
    # Get tags for the conversation
    tags = await conversation.get_tags(db)
    
    # Return the conversation with tags
    return {
        **conversation.__dict__,
        "tags": tags
    }


@router.put("/conversations/{conversation_id}", response_model=ConversationSchema)
async def update_conversation(
    conversation_id: str,
    conversation_update: ConversationUpdate,
    db: AsyncSession = Depends(get_db),
    current_user = Depends(get_current_user)
):
    """Update a conversation's metadata."""
    conversation = await Conversation.get_by_id(db, conversation_id)
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")
    
    # Ensure the current user can only update their own conversations
    # Format user IDs to ensure consistency (remove dashes if present)
    conversation_user_id = str(conversation.user_id).replace('-', '')
    current_user_id = str(current_user.id).replace('-', '')
    
    if conversation_user_id != current_user_id:
        raise HTTPException(status_code=403, detail="Not authorized to update this conversation")
    
    # Update conversation fields
    if conversation_update.title is not None:
        conversation.title = conversation_update.title
    if conversation_update.page_context is not None:
        conversation.page_context = conversation_update.page_context
    if conversation_update.page_id is not None:
        conversation.page_id = conversation_update.page_id
    if conversation_update.model is not None:
        conversation.model = conversation_update.model
    if conversation_update.server is not None:
        conversation.server = conversation_update.server
    if conversation_update.conversation_type is not None:
        conversation.conversation_type = conversation_update.conversation_type
    if conversation_update.persona_id is not None:
        conversation.persona_id = conversation_update.persona_id
    
    await db.commit()
    await db.refresh(conversation)
    
    # Get tags for the conversation
    tags = await conversation.get_tags(db)
    
    # Return the conversation with tags
    return {
        **conversation.__dict__,
        "tags": tags
    }


@router.delete("/conversations/{conversation_id}", status_code=204)
async def delete_conversation(
    conversation_id: str,
    db: AsyncSession = Depends(get_db),
    current_user = Depends(get_current_user)
):
    """Delete a conversation and all its messages."""
    conversation = await Conversation.get_by_id(db, conversation_id)
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")
    
    # Ensure the current user can only delete their own conversations
    # Format user IDs to ensure consistency (remove dashes if present)
    conversation_user_id = str(conversation.user_id).replace('-', '')
    current_user_id = str(current_user.id).replace('-', '')
    
    if conversation_user_id != current_user_id:
        raise HTTPException(status_code=403, detail="Not authorized to delete this conversation")
    
    await db.delete(conversation)
    await db.commit()
    return None


@router.get("/conversations/{conversation_id}/messages", response_model=List[MessageSchema])
async def get_conversation_messages(
    conversation_id: str,
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    current_user = Depends(get_current_user)
):
    """Get all messages for a specific conversation."""
    conversation = await Conversation.get_by_id(db, conversation_id)
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")
    
    # Ensure the current user can only access their own conversations
    # Format user IDs to ensure consistency (remove dashes if present)
    conversation_user_id = str(conversation.user_id).replace('-', '')
    current_user_id = str(current_user.id).replace('-', '')
    
    if conversation_user_id != current_user_id:
        raise HTTPException(status_code=403, detail="Not authorized to access this conversation")
    
    messages = await Message.get_by_conversation_id(db, conversation_id, skip, limit)
    return messages


@router.post("/conversations/{conversation_id}/messages", response_model=MessageSchema)
async def create_message(
    conversation_id: str,
    message: MessageCreate,
    db: AsyncSession = Depends(get_db),
    current_user = Depends(get_current_user)
):
    """Add a new message to a conversation."""
    conversation = await Conversation.get_by_id(db, conversation_id)
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")
    
    # Ensure the current user can only add messages to their own conversations
    # Format user IDs to ensure consistency (remove dashes if present)
    conversation_user_id = str(conversation.user_id).replace('-', '')
    current_user_id = str(current_user.id).replace('-', '')
    
    if conversation_user_id != current_user_id:
        raise HTTPException(status_code=403, detail="Not authorized to add messages to this conversation")
    
    db_message = Message(
        id=str(uuid.uuid4()),  # Generate ID with dashes
        conversation_id=conversation_id,  # Use conversation_id as provided
        sender=message.sender,
        message=message.message,
        message_metadata=message.message_metadata
    )
    db.add(db_message)
    
    # Update the conversation's updated_at timestamp
    conversation.updated_at = db_message.created_at
    
    await db.commit()
    await db.refresh(db_message)
    return db_message


@router.get("/conversations/{conversation_id}/with-messages", response_model=ConversationWithMessages)
async def get_conversation_with_messages(
    conversation_id: str,
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    current_user = Depends(get_current_user)
):
    """Get a conversation with all its messages."""
    conversation = await Conversation.get_by_id(db, conversation_id)
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")
    
    # Ensure the current user can only access their own conversations
    # Format user IDs to ensure consistency (remove dashes if present)
    conversation_user_id = str(conversation.user_id).replace('-', '')
    current_user_id = str(current_user.id).replace('-', '')
    
    if conversation_user_id != current_user_id:
        raise HTTPException(status_code=403, detail="Not authorized to access this conversation")
    
    messages = await Message.get_by_conversation_id(db, conversation_id, skip, limit)
    
    # Get tags for the conversation
    tags = await conversation.get_tags(db)
    
    # Create a ConversationWithMessages response
    return {
        **conversation.__dict__,
        "messages": messages,
        "tags": tags
    }


@router.get("/conversations/{conversation_id}/with-persona", response_model=ConversationWithPersona)
async def get_conversation_with_persona(
    conversation_id: str,
    db: AsyncSession = Depends(get_db),
    current_user = Depends(get_current_user)
):
    """Get a conversation with full persona details."""
    from app.schemas.conversation_schemas import ConversationWithPersona
    from app.models.persona import Persona
    
    conversation = await Conversation.get_by_id(db, conversation_id)
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")
    
    # Ensure the current user can only access their own conversations
    conversation_user_id = str(conversation.user_id).replace('-', '')
    current_user_id = str(current_user.id).replace('-', '')
    
    if conversation_user_id != current_user_id:
        raise HTTPException(status_code=403, detail="Not authorized to access this conversation")
    
    # Get tags for the conversation
    tags = await conversation.get_tags(db)
    
    # Get persona details if persona_id exists
    persona = None
    if conversation.persona_id:
        persona = await Persona.get_by_id(db, conversation.persona_id)
        # Ensure the persona belongs to the same user
        if persona and str(persona.user_id).replace('-', '') != current_user_id:
            persona = None  # Don't return persona if it doesn't belong to the user
    
    # Return the conversation with persona details
    return {
        **conversation.__dict__,
        "tags": tags,
        "persona": persona.__dict__ if persona else None
    }


@router.put("/conversations/{conversation_id}/persona", response_model=ConversationSchema)
async def update_conversation_persona(
    conversation_id: str,
    persona_id: Optional[str] = Body(None, description="ID of the persona to assign to this conversation"),
    db: AsyncSession = Depends(get_db),
    current_user = Depends(get_current_user)
):
    """Update a conversation's persona."""
    from app.models.persona import Persona
    
    conversation = await Conversation.get_by_id(db, conversation_id)
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")
    
    # Ensure the current user can only update their own conversations
    conversation_user_id = str(conversation.user_id).replace('-', '')
    current_user_id = str(current_user.id).replace('-', '')
    
    if conversation_user_id != current_user_id:
        raise HTTPException(status_code=403, detail="Not authorized to update this conversation")
    
    # Validate persona ownership if persona_id is provided
    if persona_id:
        persona = await Persona.get_by_id(db, persona_id)
        if not persona:
            raise HTTPException(status_code=404, detail="Persona not found")
        
        # Ensure the persona belongs to the same user
        persona_user_id = str(persona.user_id).replace('-', '')
        if persona_user_id != current_user_id:
            raise HTTPException(status_code=403, detail="Not authorized to use this persona")
    
    # Update conversation persona
    conversation.persona_id = persona_id
    
    await db.commit()
    await db.refresh(conversation)
    
    # Get tags for the conversation
    tags = await conversation.get_tags(db)
    
    # Return the updated conversation with tags
    return {
        **conversation.__dict__,
        "tags": tags
    }


@router.get("/conversations/by-persona/{persona_id}", response_model=List[ConversationSchema])
async def get_conversations_by_persona(
    persona_id: str,
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    current_user = Depends(get_current_user)
):
    """Get all conversations for a specific persona."""
    from app.models.persona import Persona
    from sqlalchemy import select
    
    # Verify persona exists and belongs to current user
    persona = await Persona.get_by_id(db, persona_id)
    if not persona:
        raise HTTPException(status_code=404, detail="Persona not found")
    
    # Ensure the current user can only access their own persona's conversations
    persona_user_id = str(persona.user_id).replace('-', '')
    current_user_id = str(current_user.id).replace('-', '')
    
    if persona_user_id != current_user_id:
        raise HTTPException(status_code=403, detail="Not authorized to access this persona's conversations")
    
    # Query conversations for this persona
    query = select(Conversation).where(
        Conversation.persona_id == persona_id
    ).order_by(Conversation.updated_at.desc()).offset(skip).limit(limit)
    
    result = await db.execute(query)
    conversations = result.scalars().all()
    
    # Get tags for each conversation
    conversation_with_tags = []
    for conversation in conversations:
        tags = await conversation.get_tags(db)
        conversation_with_tags.append({
            **conversation.__dict__,
            "tags": tags
        })
    
    return conversation_with_tags
