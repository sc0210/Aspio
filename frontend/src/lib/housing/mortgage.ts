/**
 * Mortgage amortization.
 *
 * The math is generic to any level-payment loan and now lives in
 * `@/lib/finance/amortization` (shared with the lifecycle-investing page).
 * This module keeps the housing-flavoured names the buy-vs-rent calculators
 * and their tests already import.
 */

export { calcAmortization as calcMortgage } from '@/lib/finance/amortization';
