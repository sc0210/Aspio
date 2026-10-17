"""
IRR Update Service

Service to calculate and update IRR values for all portfolio holdings.
Uses transaction history to calculate accurate time-weighted returns.
"""

import logging
from datetime import datetime, timezone
from decimal import Decimal
from typing import Optional
from uuid import UUID

from sqlalchemy import select, update, and_
from sqlalchemy.ext.asyncio import AsyncSession

from .models import PortfolioHolding
from .return_calculator import lot_irr

logger = logging.getLogger(__name__)


class IRRUpdateService:
    """Service to calculate and update IRR for portfolio holdings"""

    def __init__(self, session: AsyncSession):
        self.session = session

    async def update_holding_irr(self, holding_id: UUID, user_id: UUID) -> Optional[Decimal]:
        """
        Calculate and update IRR for a single holding.

        Returns the calculated IRR value or None if calculation fails.
        """
        try:
            # Get the holding
            stmt = select(PortfolioHolding).where(
                and_(
                    PortfolioHolding.id == holding_id,
                    PortfolioHolding.user_id == user_id
                )
            )
            result = await self.session.execute(stmt)
            holding = result.scalar_one_or_none()

            if not holding:
                logger.warning(f"Holding {holding_id} not found for user {user_id}")
                return None

            irr = lot_irr(holding.total_cost, holding.total_value, holding.purchase_date)

            # Written even when None: a lot under a year, or one whose old IRR came
            # from the symbol-wide ledger, must not keep a stale figure.
            await self.session.execute(
                update(PortfolioHolding)
                .where(PortfolioHolding.id == holding_id)
                .values(irr=irr, updated_at=datetime.now(timezone.utc))
            )
            await self.session.commit()
            logger.info(
                f"Updated IRR for {holding.symbol}: "
                + (f"{float(irr) * 100:.2f}%" if irr is not None else "none (held under a year or no cost)")
            )
            return irr

        except Exception as e:
            logger.error(f"Error updating IRR for holding {holding_id}: {str(e)}", exc_info=True)
            await self.session.rollback()
            return None

    async def update_all_holdings_irr(self, user_id: UUID, portfolio_id: Optional[UUID] = None) -> dict:
        """
        Calculate and update IRR for all holdings in a portfolio or for all user's holdings.

        Returns a summary of the update operation.
        """
        try:
            # Get all holdings
            conditions = [
                PortfolioHolding.user_id == user_id,
                PortfolioHolding.is_active == True
            ]

            if portfolio_id:
                conditions.append(PortfolioHolding.portfolio_id == portfolio_id)

            stmt = select(PortfolioHolding).where(and_(*conditions))
            result = await self.session.execute(stmt)
            holdings = result.scalars().all()

            total = len(holdings)
            with_irr = 0
            without_irr = 0

            logger.info(f"Starting IRR update for {total} holdings (user: {user_id})")

            for holding in holdings:
                # None is an answer, not a failure: held under a year, or no cost.
                # A real error is logged (and rolled back) inside update_holding_irr.
                irr = await self.update_holding_irr(holding.id, user_id)
                if irr is not None:
                    with_irr += 1
                else:
                    without_irr += 1

            summary = {
                "total_holdings": total,
                "updated": with_irr,
                "without_irr": without_irr,
            }

            logger.info(f"IRR update complete: {summary}")
            return summary

        except Exception as e:
            logger.error(f"Error updating IRR for all holdings: {str(e)}", exc_info=True)
            return {
                "total_holdings": 0,
                "updated": 0,
                "failed": 0,
                "error": str(e)
            }


def get_irr_update_service(session: AsyncSession) -> IRRUpdateService:
    """Factory function to get IRR update service instance"""
    return IRRUpdateService(session)
