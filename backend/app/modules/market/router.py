"""GET /market/tw-cape: the Taiwan CAPE and where it sits in its own history.

Public: it is about the market, not anyone's money, and demo mode shows it too.
"""

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.common.schemas import ApiResponse
from app.core.database import get_db

from .services import read_tw_cape

router = APIRouter()


@router.get("/tw-cape")
async def get_tw_cape(db: AsyncSession = Depends(get_db)):
    reading = await read_tw_cape(db)
    if not reading.available:
        # Too little history yet (the first sync backfills from 2005).
        return ApiResponse.success_response(data={"available": False})
    return ApiResponse.success_response(
        data={
            "available": True,
            "asOf": reading.as_of.isoformat(),
            "cape": round(reading.cape, 2),
            "percentile": round(reading.percentile, 1),
            "band": reading.band,
            "since": reading.since.isoformat(),
            "low": round(reading.low, 2),
            "high": round(reading.high, 2),
            "taiex": reading.taiex,
            "marketPe": round(reading.market_pe, 2),
            "history": [
                {"month": p.month.isoformat()[:7], "cape": round(p.cape, 2)}
                for p in reading.history
            ],
        }
    )
