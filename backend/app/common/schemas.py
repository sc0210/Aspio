"""Common schemas for Aspiro FastAPI backend"""

from datetime import datetime
from typing import Any, Dict, Generic, List, Optional, TypeVar
from pydantic import BaseModel, ConfigDict, Field

DataT = TypeVar("DataT")


class BaseSchema(BaseModel):
    """Base schema with common configuration"""
    model_config = ConfigDict(
        from_attributes=True,
        validate_assignment=True,
        arbitrary_types_allowed=True,
        str_strip_whitespace=True
    )


class TimestampMixin(BaseModel):
    """Mixin for models with timestamps"""
    created_at: datetime = Field(..., description="Creation timestamp")
    updated_at: datetime = Field(..., description="Last update timestamp")


class PaginationParams(BaseModel):
    """Pagination parameters for API requests"""
    page: int = Field(1, ge=1, description="Page number (1-based)")
    limit: int = Field(20, ge=1, le=100, description="Items per page")
    sort_by: Optional[str] = Field(None, description="Field to sort by")
    sort_order: Optional[str] = Field("asc", pattern="^(asc|desc)$", description="Sort order")

    @property
    def offset(self) -> int:
        """Calculate offset for database queries"""
        return (self.page - 1) * self.limit


class PaginationMeta(BaseModel):
    """Pagination metadata for API responses"""
    page: int = Field(..., description="Current page number")
    limit: int = Field(..., description="Items per page")
    total: int = Field(..., description="Total number of items")
    total_pages: int = Field(..., description="Total number of pages")
    has_next: bool = Field(..., description="Whether there is a next page")
    has_previous: bool = Field(..., description="Whether there is a previous page")

    @classmethod
    def create(
        cls,
        page: int,
        limit: int,
        total: int
    ) -> "PaginationMeta":
        """Create pagination metadata"""
        total_pages = (total + limit - 1) // limit  # Ceiling division
        return cls(
            page=page,
            limit=limit,
            total=total,
            total_pages=total_pages,
            has_next=page < total_pages,
            has_previous=page > 1
        )


class ApiResponse(BaseModel, Generic[DataT]):
    """Standard API response format"""
    success: bool = Field(..., description="Whether the request was successful")
    data: Optional[DataT] = Field(None, description="Response data")
    message: Optional[str] = Field(None, description="Response message")
    errors: Optional[List[str]] = Field(None, description="Error messages")
    meta: Optional[PaginationMeta] = Field(None, description="Pagination metadata")

    @classmethod
    def success_response(
        cls,
        data: Optional[DataT] = None,
        message: Optional[str] = None,
        meta: Optional[PaginationMeta] = None
    ) -> "ApiResponse[DataT]":
        """Create a success response"""
        return cls(
            success=True,
            data=data,
            message=message,
            meta=meta
        )

    @classmethod
    def error_response(
        cls,
        message: str,
        errors: Optional[List[str]] = None
    ) -> "ApiResponse[None]":
        """Create an error response"""
        return cls(
            success=False,
            message=message,
            errors=errors or []
        )


# Health check schemas
# Error schemas
class ErrorDetail(BaseModel):
    """Error detail information"""
    code: str = Field(..., description="Error code")
    message: str = Field(..., description="Error message")
    field: Optional[str] = Field(None, description="Field that caused the error")
    details: Optional[Dict[str, Any]] = Field(None, description="Additional error details")


class ValidationError(BaseModel):
    """Validation error response"""
    success: bool = Field(False, description="Request success status")
    error: str = Field("validation_error", description="Error type")
    message: str = Field(..., description="Error message")
    errors: List[ErrorDetail] = Field(..., description="List of validation errors")


# File upload schemas
# Bulk operation schemas
# Search and filter schemas
# Export commonly used schemas
__all__ = [
    "BaseSchema",
    "TimestampMixin", 
    "PaginationParams",
    "PaginationMeta",
    "ApiResponse",
    "ErrorDetail",
    "ValidationError",
]