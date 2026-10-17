import { apiClient } from '@/lib/api-client';
import { ApiResponse } from '@/shared/types';

export type LoanAccountType =
  | 'personal_loan'
  | 'mortgage'
  | 'auto_loan'
  | 'student_loan'
  | 'credit_card'
  | 'other';

export type LoanStatus = 'active' | 'paid_off' | 'paused';

export interface DebtAccount {
  id: string;
  user_id: string;
  name: string;
  lender_name: string | null;
  account_type: LoanAccountType;
  principal_amount: number;
  current_balance: number;
  interest_rate: number;
  minimum_payment: number;
  payment_due_day: number;
  start_date: string;
  term_months: number | null;
  currency: string;
  status: LoanStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
  // computed
  progress_pct: number | null;
  /** Months left on the contract term. */
  months_remaining: number | null;
  /** Months to payoff at the current minimum payment — differs from
   *  months_remaining when the payment does not amortise the term exactly. */
  payoff_months_estimate: number | null;
  total_interest_remaining: number | null;
  next_payment_date: string | null;
}

export interface DebtAccountSummary {
  total_debt: number;
  loan_count: number;
  next_payment_date: string | null;
  next_payment_amount: number | null;
  loans: DebtAccount[];
}

export interface DebtAccountCreate {
  name: string;
  lender_name?: string;
  account_type: LoanAccountType;
  principal_amount: number;
  current_balance?: number;
  interest_rate: number;
  minimum_payment: number;
  payment_due_day: number;
  start_date: string;
  term_months?: number;
  currency?: string;
  notes?: string;
}

export interface DebtAccountUpdate {
  name?: string;
  lender_name?: string;
  interest_rate?: number;
  minimum_payment?: number;
  payment_due_day?: number;
  term_months?: number;
  status?: LoanStatus;
  notes?: string;
}

export interface LoanPaymentCreate {
  payment_date: string;
  total_amount: number;
  principal_portion: number;
  interest_portion: number;
  notes?: string;
}

interface LoanPaymentResponse {
  transaction_id: string;
  loan_id: string;
  payment_date: string;
  total_amount: number;
  principal_portion: number;
  interest_portion: number;
  new_balance: number;
  is_paid_off: boolean;
}

export interface LoanPaymentRecord {
  transaction_id: string;
  loan_id: string;
  payment_date: string;
  total_amount: number;
  principal_portion: number;
  interest_portion: number;
  notes: string | null;
  created_at: string;
}

export interface LoanPaymentUpdate {
  payment_date?: string;
  total_amount?: number;
  principal_portion?: number;
  interest_portion?: number;
  notes?: string;
}

class LoanService {
  async getLoans(): Promise<ApiResponse<DebtAccount[]>> {
    return apiClient.get<DebtAccount[]>('/loans/');
  }

  async getSummary(): Promise<ApiResponse<DebtAccountSummary>> {
    return apiClient.get<DebtAccountSummary>('/loans/summary');
  }

  async getLoan(id: string): Promise<ApiResponse<DebtAccount>> {
    return apiClient.get<DebtAccount>(`/loans/${id}`);
  }

  async createLoan(data: DebtAccountCreate): Promise<ApiResponse<DebtAccount>> {
    return apiClient.post<DebtAccount>('/loans/', data);
  }

  async updateLoan(id: string, data: DebtAccountUpdate): Promise<ApiResponse<DebtAccount>> {
    return apiClient.put<DebtAccount>(`/loans/${id}`, data);
  }

  async deleteLoan(id: string): Promise<ApiResponse<void>> {
    return apiClient.delete<void>(`/loans/${id}`);
  }

  async recordPayment(id: string, data: LoanPaymentCreate): Promise<ApiResponse<LoanPaymentResponse>> {
    return apiClient.post<LoanPaymentResponse>(`/loans/${id}/payment`, data);
  }

  async getPayments(loanId: string): Promise<ApiResponse<LoanPaymentRecord[]>> {
    return apiClient.get<LoanPaymentRecord[]>(`/loans/${loanId}/payments`);
  }

  async updatePayment(loanId: string, transactionId: string, data: LoanPaymentUpdate): Promise<ApiResponse<LoanPaymentRecord>> {
    return apiClient.put<LoanPaymentRecord>(`/loans/${loanId}/payments/${transactionId}`, data);
  }

  async deletePayment(loanId: string, transactionId: string): Promise<ApiResponse<void>> {
    return apiClient.delete<void>(`/loans/${loanId}/payments/${transactionId}`);
  }
}

export const loanService = new LoanService();
