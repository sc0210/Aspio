"""
Security utilities for user authentication and authorization.

This module provides comprehensive security functions including password hashing,
JWT token management, OAuth handling, and security validation.
"""

import secrets
import hashlib
from datetime import datetime, timedelta, timezone
from typing import Optional, Dict, Any
import uuid

import jwt
from jwt import PyJWTError
from passlib.context import CryptContext
import httpx

from ...core.config import get_settings

settings = get_settings()

# Password hashing configuration
pwd_context = CryptContext(
    schemes=["bcrypt"],
    deprecated="auto",
    bcrypt__rounds=12,  # Strong hashing rounds for security
    bcrypt__ident="2b"  # Use bcrypt variant 2b
)

# JWT Configuration
ALGORITHM = settings.ALGORITHM
SECRET_KEY = settings.SECRET_KEY
ACCESS_TOKEN_EXPIRE_MINUTES = settings.ACCESS_TOKEN_EXPIRE_MINUTES
REFRESH_TOKEN_EXPIRE_DAYS = settings.REFRESH_TOKEN_EXPIRE_DAYS


class SecurityUtils:
    """Utility class for security operations"""
    
    @staticmethod
    def hash_password(password: str) -> str:
        """
        Hash a password using bcrypt with strong security settings.
        
        Args:
            password: Plain text password to hash
            
        Returns:
            Bcrypt hashed password string
        """
        return pwd_context.hash(password)
    
    @staticmethod
    def verify_password(plain_password: str, hashed_password: str) -> bool:
        """
        Verify a password against its hash.
        
        Args:
            plain_password: Plain text password to verify
            hashed_password: Stored bcrypt hash
            
        Returns:
            True if password matches, False otherwise
        """
        try:
            return pwd_context.verify(plain_password, hashed_password)
        except Exception:
            # Handle any potential bcrypt verification errors
            return False
    
    @staticmethod
    def generate_secure_token(length: int = 32) -> str:
        """
        Generate a cryptographically secure random token.
        
        Args:
            length: Length of the token in bytes
            
        Returns:
            Hex-encoded secure random token
        """
        return secrets.token_hex(length)
    
    @staticmethod
    def hash_token(token: str) -> str:
        """
        Hash a token using SHA256 for secure storage.
        
        Args:
            token: Token to hash
            
        Returns:
            SHA256 hash of the token
        """
        return hashlib.sha256(token.encode()).hexdigest()
    
class JWTManager:
    """JWT token management for authentication"""
    
    @staticmethod
    def create_access_token(
        data: Dict[str, Any],
        expires_delta: Optional[timedelta] = None
    ) -> str:
        """
        Create a JWT access token.
        
        Args:
            data: Data to encode in the token
            expires_delta: Optional custom expiration time
            
        Returns:
            Encoded JWT token string
        """
        to_encode = data.copy()
        
        if expires_delta:
            expire = datetime.now(timezone.utc) + expires_delta
        else:
            expire = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
        
        to_encode.update({
            "exp": expire,
            "iat": datetime.now(timezone.utc),
            "type": "access"
        })
        
        return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    
    @staticmethod
    def create_refresh_token(
        data: Dict[str, Any],
        expires_delta: Optional[timedelta] = None
    ) -> str:
        """
        Create a JWT refresh token.
        
        Args:
            data: Data to encode in the token
            expires_delta: Optional custom expiration time
            
        Returns:
            Encoded JWT refresh token string
        """
        to_encode = data.copy()
        
        if expires_delta:
            expire = datetime.now(timezone.utc) + expires_delta
        else:
            expire = datetime.now(timezone.utc) + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)
        
        to_encode.update({
            "exp": expire,
            "iat": datetime.now(timezone.utc),
            "jti": str(uuid.uuid4()),
            "type": "refresh"
        })

        return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    
    @staticmethod
    def verify_token(token: str, token_type: str = "access") -> Optional[Dict[str, Any]]:
        """
        Verify and decode a JWT token.
        
        Args:
            token: JWT token to verify
            token_type: Expected token type (access or refresh)
            
        Returns:
            Decoded token payload or None if invalid
        """
        try:
            payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
            
            # Verify token type
            if payload.get("type") != token_type:
                return None
            
            # Verify expiration — use timezone-aware comparison throughout
            exp = payload.get("exp")
            if exp is None or datetime.fromtimestamp(exp, tz=timezone.utc) < datetime.now(timezone.utc):
                return None
            
            return payload
            
        except PyJWTError:
            return None
    
class GoogleOAuthManager:
    """Google OAuth 2.0 integration manager"""
    
    GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
    GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo"
    GOOGLE_TOKENINFO_URL = "https://oauth2.googleapis.com/tokeninfo"

    def __init__(self):
        self.client_id = settings.GOOGLE_CLIENT_ID
        self.client_secret = settings.GOOGLE_CLIENT_SECRET
        self.redirect_uri = settings.effective_google_redirect_uri
        self.authorization_base_url = "https://accounts.google.com/o/oauth2/v2/auth"
    
    def get_authorization_url(self, redirect_uri: Optional[str] = None) -> str:
        """
        Get Google OAuth authorization URL.
        
        Args:
            redirect_uri: Override redirect URI
            
        Returns:
            Google OAuth authorization URL
        """
        import urllib.parse
        
        params = {
            "client_id": self.client_id,
            "redirect_uri": redirect_uri or self.redirect_uri,
            "scope": "openid email profile",
            "response_type": "code",
            "access_type": "offline",
            "prompt": "consent"
        }
        
        query_string = urllib.parse.urlencode(params)
        return f"{self.authorization_base_url}?{query_string}"
    
    async def exchange_code_for_tokens(
        self, 
        authorization_code: str,
        redirect_uri: Optional[str] = None
    ) -> Optional[Dict[str, Any]]:
        """
        Exchange authorization code for access and refresh tokens.
        
        Args:
            authorization_code: Authorization code from Google
            redirect_uri: Override redirect URI
            
        Returns:
            Token response or None if failed
        """
        if not self.client_id or not self.client_secret:
            raise ValueError("Google OAuth not configured")
        
        token_data = {
            "code": authorization_code,
            "client_id": self.client_id,
            "client_secret": self.client_secret,
            "redirect_uri": redirect_uri or self.redirect_uri,
            "grant_type": "authorization_code"
        }
        
        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    self.GOOGLE_TOKEN_URL,
                    data=token_data,
                    headers={"Content-Type": "application/x-www-form-urlencoded"}
                )
                
                if response.status_code == 200:
                    return response.json()
                else:
                    return None
                    
        except Exception:
            return None
    
    async def get_user_info(self, access_token: str) -> Optional[Dict[str, Any]]:
        """
        Get user information from Google using access token.
        
        Args:
            access_token: Google access token
            
        Returns:
            User information or None if failed
        """
        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(
                    self.GOOGLE_USERINFO_URL,
                    headers={"Authorization": f"Bearer {access_token}"}
                )
                
                if response.status_code == 200:
                    return response.json()
                else:
                    return None

        except Exception:
            return None

    async def verify_token_identity(self, token: str) -> Optional[Dict[str, Any]]:
        """
        Ask Google who a NextAuth-supplied token belongs to.

        The callback body's email and id are whatever the caller wrote, so they
        prove nothing; only Google's answer about the token does. The token must
        have been issued to this app's client (an access token another app holds
        for the same person must not log in here) and carry a verified email.

        Returns {"sub", "email"} or None, and None whenever Google OAuth is not
        configured, so the check fails closed.
        """
        if not token or not self.client_id:
            return None

        # An ID token is a JWT; anything else is treated as an access token.
        param = "id_token" if token.count(".") == 2 else "access_token"
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                response = await client.get(self.GOOGLE_TOKENINFO_URL, params={param: token})
        except Exception:
            return None
        if response.status_code != 200:
            return None

        info = response.json()
        if self.client_id not in (info.get("aud"), info.get("azp")):
            return None
        # tokeninfo reports this as the string "true".
        if str(info.get("email_verified")).lower() != "true":
            return None
        if not info.get("sub") or not info.get("email"):
            return None
        return {"sub": info["sub"], "email": info["email"]}

class PasswordValidator:
    """Password strength validation utilities"""
    
    @staticmethod
    def validate_password_strength(password: str) -> Dict[str, Any]:
        """
        Comprehensive password strength validation.
        
        Args:
            password: Password to validate
            
        Returns:
            Dictionary with validation results and score
        """
        result = {
            "is_valid": False,
            "score": 0,
            "feedback": [],
            "requirements": {
                "min_length": False,
                "has_uppercase": False,
                "has_lowercase": False,
                "has_number": False,
                "has_special": False,
                "no_common_patterns": False
            }
        }
        
        # Check minimum length
        if len(password) >= 8:
            result["requirements"]["min_length"] = True
            result["score"] += 20
        else:
            result["feedback"].append("Password must be at least 8 characters long")
        
        # Check for uppercase letter
        if any(c.isupper() for c in password):
            result["requirements"]["has_uppercase"] = True
            result["score"] += 15
        else:
            result["feedback"].append("Password must contain at least one uppercase letter")
        
        # Check for lowercase letter
        if any(c.islower() for c in password):
            result["requirements"]["has_lowercase"] = True
            result["score"] += 15
        else:
            result["feedback"].append("Password must contain at least one lowercase letter")
        
        # Check for number
        if any(c.isdigit() for c in password):
            result["requirements"]["has_number"] = True
            result["score"] += 15
        else:
            result["feedback"].append("Password must contain at least one number")
        
        # Check for special character
        special_chars = "!@#$%^&*()_+-=[]{}|;:,.<>?"
        if any(c in special_chars for c in password):
            result["requirements"]["has_special"] = True
            result["score"] += 15
        else:
            result["feedback"].append("Password should contain at least one special character")
        
        # Check for common patterns
        common_patterns = [
            "password", "123456", "qwerty", "admin", "letmein",
            "welcome", "monkey", "dragon", "master", "shadow"
        ]
        
        password_lower = password.lower()
        has_common_pattern = any(pattern in password_lower for pattern in common_patterns)
        
        if not has_common_pattern:
            result["requirements"]["no_common_patterns"] = True
            result["score"] += 10
        else:
            result["feedback"].append("Password contains common patterns")
        
        # Additional scoring for length
        if len(password) >= 12:
            result["score"] += 10
        
        # Check for sequential characters
        has_sequence = False
        for i in range(len(password) - 2):
            if (ord(password[i+1]) == ord(password[i]) + 1 and 
                ord(password[i+2]) == ord(password[i]) + 2):
                has_sequence = True
                break
        
        if has_sequence:
            result["score"] -= 10
            result["feedback"].append("Avoid sequential characters")
        
        # Password is valid if it meets basic requirements
        result["is_valid"] = all([
            result["requirements"]["min_length"],
            result["requirements"]["has_uppercase"],
            result["requirements"]["has_lowercase"],
            result["requirements"]["has_number"]
        ])
        
        return result


class AccountSecurity:
    """Account security utilities for rate limiting and protection"""
    
    @staticmethod
    def should_lock_account(failed_attempts: int) -> bool:
        """
        Determine if account should be locked based on failed attempts.
        
        Args:
            failed_attempts: Number of consecutive failed login attempts
            
        Returns:
            True if account should be locked
        """
        return failed_attempts >= 5
    
    @staticmethod
    def calculate_lockout_duration(failed_attempts: int) -> timedelta:
        """
        Calculate account lockout duration based on failed attempts.
        
        Args:
            failed_attempts: Number of consecutive failed login attempts
            
        Returns:
            Lockout duration as timedelta
        """
        if failed_attempts < 5:
            return timedelta(0)
        elif failed_attempts < 10:
            return timedelta(minutes=15)
        elif failed_attempts < 20:
            return timedelta(hours=1)
        else:
            return timedelta(hours=24)
    
class DataEncryption:
    """Data encryption utilities for sensitive information"""

# Initialize global instances
security_utils = SecurityUtils()
jwt_manager = JWTManager()
google_oauth = GoogleOAuthManager()
password_validator = PasswordValidator()
account_security = AccountSecurity()
data_encryption = DataEncryption()

# Export utilities
__all__ = [
    "SecurityUtils",
    "JWTManager", 
    "GoogleOAuthManager",
    "PasswordValidator",
    "AccountSecurity",
    "DataEncryption",
    "security_utils",
    "jwt_manager",
    "google_oauth", 
    "password_validator",
    "account_security",
    "data_encryption"
]