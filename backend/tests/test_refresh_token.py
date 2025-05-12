import pytest
from fastapi.testclient import TestClient
from datetime import datetime, timedelta
from app.core.security import create_access_token, hash_password
from app.models.user import User
from sqlalchemy.ext.asyncio import AsyncSession
import uuid

@pytest.mark.asyncio
async def test_refresh_token_flow(client: TestClient, db: AsyncSession):
    # 1. Create a test user with hashed password
    password = "test123"
    hashed = hash_password(password)
    
    user_id = str(uuid.uuid4())
    test_user = User(
        id=user_id,
        username="test_user",
        email="test@example.com",
        password=hashed  # Field name is 'password' not 'hashed_password'
    )
    await test_user.save(db)  # Using the save method instead of db.add and commit
    
    # 2. Login to get initial tokens
    response = client.post("/api/v1/auth/login", json={
        "email": "test@example.com",
        "password": "test123"
    })
    assert response.status_code == 200
    login_data = response.json()
    assert "access_token" in login_data
    
    # Store the refresh token from cookies and response body
    set_cookie_header = response.headers.get("set-cookie")
    assert set_cookie_header is not None
    
    # Extract refresh token from cookie
    cookie_parts = set_cookie_header.split(";")
    refresh_token_cookie = None
    for part in cookie_parts:
        if part.strip().startswith("refresh_token="):
            refresh_token_cookie = part.strip().split("=", 1)[1]
            break
    
    assert refresh_token_cookie is not None
    
    # Also check that refresh token is in response body as fallback
    assert "refresh_token" in login_data
    refresh_token_body = login_data["refresh_token"]
    assert refresh_token_body is not None
    
    # Both should match
    assert refresh_token_cookie == refresh_token_body
    
    # Use the token from the cookie for the test
    refresh_token = refresh_token_cookie
    
    # 3. Use refresh token to get new access token
    response = client.post(
        "/api/v1/auth/refresh",
        cookies={"refresh_token": refresh_token}
    )
    assert response.status_code == 200
    refresh_data = response.json()
    assert "access_token" in refresh_data
    assert refresh_data["access_token"] != login_data["access_token"]
    
    # 4. Verify new refresh token was issued
    set_cookie_header = response.headers.get("set-cookie")
    assert set_cookie_header is not None
    
    # Extract new refresh token from cookie
    cookie_parts = set_cookie_header.split(";")
    new_refresh_token_cookie = None
    for part in cookie_parts:
        if part.strip().startswith("refresh_token="):
            new_refresh_token_cookie = part.strip().split("=", 1)[1]
            break
    
    assert new_refresh_token_cookie is not None
    
    # Also check that new refresh token is in response body
    assert "refresh_token" in refresh_data
    new_refresh_token_body = refresh_data["refresh_token"]
    assert new_refresh_token_body is not None
    
    # Both should match
    assert new_refresh_token_cookie == new_refresh_token_body
    
    # Tokens should be different (token rotation)
    assert new_refresh_token_cookie != refresh_token
    
    new_refresh_token = new_refresh_token_cookie
    
    # 5. Try to use old refresh token (should fail)
    response = client.post(
        "/api/v1/auth/refresh",
        cookies={"refresh_token": refresh_token}
    )
    assert response.status_code == 401
    
    # 6. Verify new refresh token still works
    response = client.post(
        "/api/v1/auth/refresh",
        cookies={"refresh_token": new_refresh_token}
    )
    assert response.status_code == 200
    final_response = response.json()
    assert "access_token" in final_response
    
    # 7. Test with both cookie and body fallback
    # Clear the user's refresh token in the database to simulate a lost server-side token
    user = await User.get_by_id(db, user_id)
    user.refresh_token = None
    await user.save(db)
    
    # Try to refresh with the token in the request body as fallback
    response = client.post(
        "/api/v1/auth/refresh",
        json={"refresh_token": new_refresh_token}
    )
    
    # This should fail because we cleared the token in the database
    assert response.status_code == 401
