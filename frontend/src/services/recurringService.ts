import { apiClient } from '@/lib/api-client';

/**
 * Repeating bills the user records by hand ("reminders": recurring rules without
 * auto_create). Each one comes due, and the user records it (adjusting the
 * amount, which the rule then remembers) or skips it. Bills split with a
 * partner are rules too, but they post themselves and live under Savings.
 */

export type BillFrequency = 'weekly' | 'monthly' | 'quarterly' | 'yearly';

export interface Bill {
  id: string;
  description: string;
  amount: number;
  currency: string;
  categoryId: string;
  category: string;
  subcategory: string | null;
  paymentMethod: string | null;
  frequency: BillFrequency;
  interval: number;
  /** YYYY-MM-DD: the occurrence waiting to be recorded or skipped. */
  nextOccurrence: string;
  /** YYYY-MM-DD: its day of the month is the day the bill comes round. */
  startDate: string;
  isActive: boolean;
  isPaused: boolean;
  /** Posts itself (a split bill, or an older auto-create rule): not a reminder. */
  autoCreate: boolean;
  isSplit: boolean;
}

export interface BillSuggestion {
  description: string;
  categoryId: string;
  category: string;
  subcategory: string | null;
  amount: number;
  currency: string;
  paymentMethod: string | null;
  dayOfMonth: number;
  monthsSeen: number;
  lastDate: string;
}

export interface NewBill {
  description: string;
  amount: number;
  currency: string;
  categoryId: string;
  subcategory?: string | null;
  paymentMethod?: string | null;
  frequency: BillFrequency;
  /** YYYY-MM-DD of the first reminder; later ones keep its day of the month. */
  startDate: string;
}

type Raw = Record<string, unknown>;

// Decimal fields arrive as strings (Pydantic Decimal → JSON string).
const num = (v: unknown) => Number(v ?? 0);

function toBill(r: Raw): Bill {
  const category = r.category as Raw | null | undefined;
  return {
    id: String(r.id),
    description: String(r.description ?? ''),
    amount: num(r.amount),
    currency: String(r.currency ?? 'TWD'),
    categoryId: String(r.category_id ?? ''),
    category: String(category?.name ?? ''),
    subcategory: (r.subcategory as string | null) ?? null,
    paymentMethod: (r.payment_method as string | null) ?? null,
    frequency: (r.frequency as BillFrequency) ?? 'monthly',
    interval: num(r.interval) || 1,
    nextOccurrence: String(r.next_occurrence),
    startDate: String(r.start_date),
    isActive: r.is_active !== false,
    isPaused: r.is_paused === true,
    autoCreate: r.auto_create === true,
    isSplit: !!r.split_connection_id,
  };
}

function toSuggestion(r: Raw): BillSuggestion {
  return {
    description: String(r.description ?? ''),
    categoryId: String(r.category_id ?? ''),
    category: String(r.category ?? ''),
    subcategory: (r.subcategory as string | null) ?? null,
    amount: num(r.amount),
    currency: String(r.currency ?? 'TWD'),
    paymentMethod: (r.payment_method as string | null) ?? null,
    dayOfMonth: num(r.day_of_month),
    monthsSeen: num(r.months_seen),
    lastDate: String(r.last_date),
  };
}

const list = (data: unknown): Raw[] => (Array.isArray(data) ? (data as Raw[]) : []);

export const recurringService = {
  /** Every rule of the user's that is a reminder (not split, not self-posting). */
  async listBills(): Promise<Bill[]> {
    const res = await apiClient.get<Raw[]>('/transactions/recurring');
    return list(res.data).map(toBill).filter((b) => b.isActive && !b.isSplit && !b.autoCreate);
  },

  /** Reminders due on or before `until` (YYYY-MM-DD), oldest first. */
  async dueBills(until: string): Promise<Bill[]> {
    const res = await apiClient.get<Raw[]>(`/transactions/recurring/due?until=${encodeURIComponent(until)}`);
    return list(res.data).map(toBill);
  },

  async suggestions(): Promise<BillSuggestion[]> {
    const res = await apiClient.get<Raw[]>('/transactions/recurring/suggestions');
    return list(res.data).map(toSuggestion);
  },

  async createBill(bill: NewBill): Promise<void> {
    await apiClient.post('/transactions/recurring', {
      type: 'expense',
      amount: bill.amount,
      currency: bill.currency,
      category_id: bill.categoryId,
      subcategory: bill.subcategory || null,
      description: bill.description,
      payment_method: bill.paymentMethod || null,
      frequency: bill.frequency,
      interval: 1,
      start_date: bill.startDate,
      auto_create: false,
      requires_approval: true,
    });
  },

  /** Amount, description, or a new day: startDate is the anchor later dates keep, nextOccurrence the one now due. */
  async updateBill(
    id: string,
    changes: Partial<{
      amount: number; description: string; startDate: string; nextOccurrence: string; isPaused: boolean; isActive: boolean;
    }>,
  ): Promise<void> {
    const body: Record<string, unknown> = {};
    if (changes.amount !== undefined) body.amount = changes.amount;
    if (changes.description !== undefined) body.description = changes.description;
    if (changes.startDate !== undefined) body.start_date = changes.startDate;
    if (changes.nextOccurrence !== undefined) body.next_occurrence = changes.nextOccurrence;
    if (changes.isPaused !== undefined) body.is_paused = changes.isPaused;
    if (changes.isActive !== undefined) body.is_active = changes.isActive;
    await apiClient.put(`/transactions/recurring/${id}`, body);
  },

  /** Record the occurrence the user saw. 409 when it was already recorded or skipped. */
  async recordBill(id: string, occurrence: string, amount: number, date?: string): Promise<void> {
    await apiClient.post(`/transactions/recurring/${id}/confirm`, {
      occurrence,
      amount,
      ...(date ? { transaction_date: date } : {}),
    });
  },

  async skipBill(id: string, occurrence: string): Promise<void> {
    await apiClient.post(`/transactions/recurring/${id}/skip`, { occurrence });
  },
};
