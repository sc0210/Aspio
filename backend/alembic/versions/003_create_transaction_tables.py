"""Create transaction tables for Aspiro personal finance application

Revision ID: 003_create_transaction_tables
Revises: 002_create_user_tables
Create Date: 2024-09-09 20:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = '003_create_transaction_tables'
down_revision: Union[str, None] = '002_create_user_tables'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Create transaction-related tables"""
    
    # Create currencies table
    op.create_table('currencies',
        sa.Column('code', sa.String(length=3), nullable=False),
        sa.Column('name', sa.String(length=100), nullable=False),
        sa.Column('symbol', sa.String(length=10), nullable=False),
        sa.Column('exchange_rate_usd', sa.Numeric(precision=15, scale=8), nullable=False),
        sa.Column('region', sa.String(length=50), nullable=True),
        sa.Column('is_major', sa.Boolean(), nullable=True, default=False),
        sa.Column('is_active', sa.Boolean(), nullable=True, default=True),
        sa.Column('last_updated', sa.DateTime(), nullable=True, default=sa.func.now()),
        sa.Column('created_at', sa.DateTime(), nullable=False, default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(), nullable=False, default=sa.func.now(), onupdate=sa.func.now()),
        sa.PrimaryKeyConstraint('code')
    )
    
    # Create transaction_categories table
    op.create_table('transaction_categories',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('name', sa.String(length=100), nullable=False),
        sa.Column('name_en', sa.String(length=100), nullable=True),
        sa.Column('name_zh', sa.String(length=100), nullable=True),
        sa.Column('name_ms', sa.String(length=100), nullable=True),
        sa.Column('name_th', sa.String(length=100), nullable=True),
        sa.Column('type', sa.Enum('INCOME', 'EXPENSE', name='categorytype'), nullable=False),
        sa.Column('color', sa.String(length=7), nullable=True, default='#6B7280'),
        sa.Column('icon', sa.String(length=50), nullable=True, default='receipt'),
        sa.Column('parent_id', sa.String(length=36), nullable=True),
        sa.Column('is_default', sa.Boolean(), nullable=True, default=False),
        sa.Column('is_active', sa.Boolean(), nullable=True, default=True),
        sa.Column('is_system', sa.Boolean(), nullable=True, default=False),
        sa.Column('usage_count', sa.Integer(), nullable=True, default=0),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('keywords', sa.JSON(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False, default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(), nullable=False, default=sa.func.now(), onupdate=sa.func.now()),
        sa.ForeignKeyConstraint(['parent_id'], ['transaction_categories.id'], ),
        sa.PrimaryKeyConstraint('id')
    )
    
    # Create indexes for transaction_categories
    op.create_index('idx_transaction_categories_active', 'transaction_categories', ['is_active'])
    op.create_index('idx_transaction_categories_parent', 'transaction_categories', ['parent_id'])
    op.create_index('idx_transaction_categories_type', 'transaction_categories', ['type'])
    op.create_index('idx_transaction_categories_usage', 'transaction_categories', ['usage_count'])
    
    # Create recurring_transactions table
    op.create_table('recurring_transactions',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('user_id', sa.String(length=36), nullable=False),
        sa.Column('type', sa.Enum('INCOME', 'EXPENSE', name='transactiontype'), nullable=False),
        sa.Column('amount', sa.Numeric(precision=15, scale=2), nullable=False),
        sa.Column('currency', sa.String(length=3), nullable=False),
        sa.Column('category_id', sa.String(length=36), nullable=False),
        sa.Column('description', sa.String(length=500), nullable=False),
        sa.Column('payment_method', sa.Enum(
            'CASH', 'CREDIT_CARD', 'DEBIT_CARD', 'BANK_TRANSFER', 
            'WECHAT_PAY', 'ALIPAY', 'LINE_PAY', 'SHOPEE_PAY', 'GRAB_PAY', 'MOMO', 'PAYNOW',
            'TOUCH_N_GO', 'BOOST', 'GCASH', 'DANA', 'OVO', 'GOPAY', 
            'CRYPTOCURRENCY', 'CHEQUE', 'OTHER', 
            name='paymentmethod'
        ), nullable=True),
        sa.Column('frequency', sa.Enum('DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY', name='recurringfrequency'), nullable=False),
        sa.Column('interval', sa.Integer(), nullable=True, default=1),
        sa.Column('start_date', sa.Date(), nullable=False),
        sa.Column('end_date', sa.Date(), nullable=True),
        sa.Column('max_occurrences', sa.Integer(), nullable=True),
        sa.Column('next_occurrence', sa.Date(), nullable=False),
        sa.Column('occurrence_count', sa.Integer(), nullable=True, default=0),
        sa.Column('is_active', sa.Boolean(), nullable=True, default=True),
        sa.Column('is_paused', sa.Boolean(), nullable=True, default=False),
        sa.Column('auto_create', sa.Boolean(), nullable=True, default=False),
        sa.Column('requires_approval', sa.Boolean(), nullable=True, default=True),
        sa.Column('tags', sa.JSON(), nullable=True),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False, default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(), nullable=False, default=sa.func.now(), onupdate=sa.func.now()),
        sa.CheckConstraint('amount > 0', name='check_positive_amount'),
        sa.CheckConstraint('interval > 0', name='check_positive_interval'),
        sa.ForeignKeyConstraint(['category_id'], ['transaction_categories.id'], ),
        sa.PrimaryKeyConstraint('id')
    )
    
    # Create indexes for recurring_transactions
    op.create_index('idx_recurring_active', 'recurring_transactions', ['is_active'])
    op.create_index('idx_recurring_frequency', 'recurring_transactions', ['frequency'])
    op.create_index('idx_recurring_next_occurrence', 'recurring_transactions', ['next_occurrence'])
    op.create_index('idx_recurring_user', 'recurring_transactions', ['user_id'])
    
    # Create transactions table
    op.create_table('transactions',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('user_id', sa.String(length=36), nullable=False),
        sa.Column('type', sa.Enum('INCOME', 'EXPENSE', name='transactiontype'), nullable=False),
        sa.Column('amount', sa.Numeric(precision=15, scale=2), nullable=False),
        sa.Column('currency', sa.String(length=3), nullable=False, default='USD'),
        sa.Column('amount_usd', sa.Numeric(precision=15, scale=2), nullable=True),
        sa.Column('exchange_rate', sa.Numeric(precision=15, scale=8), nullable=True),
        sa.Column('description', sa.String(length=500), nullable=False),
        sa.Column('transaction_date', sa.Date(), nullable=False),
        sa.Column('category_id', sa.String(length=36), nullable=False),
        sa.Column('subcategory', sa.String(length=100), nullable=True),
        sa.Column('payment_method', sa.Enum(
            'CASH', 'CREDIT_CARD', 'DEBIT_CARD', 'BANK_TRANSFER', 
            'WECHAT_PAY', 'ALIPAY', 'LINE_PAY', 'SHOPEE_PAY', 'GRAB_PAY', 'MOMO', 'PAYNOW',
            'TOUCH_N_GO', 'BOOST', 'GCASH', 'DANA', 'OVO', 'GOPAY', 
            'CRYPTOCURRENCY', 'CHEQUE', 'OTHER', 
            name='paymentmethod'
        ), nullable=True),
        sa.Column('payment_account', sa.String(length=100), nullable=True),
        sa.Column('merchant_name', sa.String(length=200), nullable=True),
        sa.Column('location', sa.String(length=500), nullable=True),
        sa.Column('latitude', sa.Numeric(precision=10, scale=8), nullable=True),
        sa.Column('longitude', sa.Numeric(precision=11, scale=8), nullable=True),
        sa.Column('reference_id', sa.String(length=100), nullable=True),
        sa.Column('receipt_url', sa.String(length=500), nullable=True),
        sa.Column('receipt_data', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('status', sa.Enum('PENDING', 'COMPLETED', 'FAILED', 'CANCELLED', name='transactionstatus'), nullable=True, default='COMPLETED'),
        sa.Column('processed_at', sa.DateTime(), nullable=True),
        sa.Column('tags', sa.JSON(), nullable=True),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('recurring_transaction_id', sa.String(length=36), nullable=True),
        sa.Column('import_source', sa.String(length=100), nullable=True),
        sa.Column('import_batch_id', sa.String(length=36), nullable=True),
        sa.Column('auto_categorized', sa.Boolean(), nullable=True, default=False),
        sa.Column('categorization_confidence', sa.Numeric(precision=3, scale=2), nullable=True),
        sa.Column('reviewed_by_user', sa.Boolean(), nullable=True, default=False),
        sa.Column('qr_payment_data', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('tax_deductible', sa.Boolean(), nullable=True, default=False),
        sa.Column('business_expense', sa.Boolean(), nullable=True, default=False),
        sa.Column('is_deleted', sa.Boolean(), nullable=True, default=False),
        sa.Column('deleted_at', sa.DateTime(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False, default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(), nullable=False, default=sa.func.now(), onupdate=sa.func.now()),
        sa.CheckConstraint('amount > 0', name='check_positive_amount'),
        sa.CheckConstraint('categorization_confidence >= 0 AND categorization_confidence <= 1', name='check_confidence_range'),
        sa.ForeignKeyConstraint(['category_id'], ['transaction_categories.id'], ),
        sa.ForeignKeyConstraint(['currency'], ['currencies.code'], ),
        sa.ForeignKeyConstraint(['recurring_transaction_id'], ['recurring_transactions.id'], ),
        sa.PrimaryKeyConstraint('id')
    )
    
    # Create indexes for transactions
    op.create_index('idx_transactions_amount', 'transactions', ['amount'])
    op.create_index('idx_transactions_auto_categorized', 'transactions', ['auto_categorized'])
    op.create_index('idx_transactions_category', 'transactions', ['category_id'])
    op.create_index('idx_transactions_currency', 'transactions', ['currency'])
    op.create_index('idx_transactions_import', 'transactions', ['import_source', 'import_batch_id'])
    op.create_index('idx_transactions_location', 'transactions', ['latitude', 'longitude'])
    op.create_index('idx_transactions_merchant', 'transactions', ['merchant_name'])
    op.create_index('idx_transactions_payment_method', 'transactions', ['payment_method'])
    op.create_index('idx_transactions_recurring', 'transactions', ['recurring_transaction_id'])
    op.create_index('idx_transactions_soft_delete', 'transactions', ['is_deleted'])
    op.create_index('idx_transactions_status', 'transactions', ['status'])
    op.create_index('idx_transactions_user_date', 'transactions', ['user_id', 'transaction_date'])
    op.create_index('idx_transactions_user_type', 'transactions', ['user_id', 'type'])
    
    # Create transaction_attachments table
    op.create_table('transaction_attachments',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('transaction_id', sa.String(length=36), nullable=False),
        sa.Column('filename', sa.String(length=255), nullable=False),
        sa.Column('original_filename', sa.String(length=255), nullable=False),
        sa.Column('file_size', sa.Integer(), nullable=False),
        sa.Column('mime_type', sa.String(length=100), nullable=False),
        sa.Column('file_path', sa.String(length=500), nullable=False),
        sa.Column('storage_provider', sa.String(length=50), nullable=True, default='local'),
        sa.Column('ocr_text', sa.Text(), nullable=True),
        sa.Column('processed', sa.Boolean(), nullable=True, default=False),
        sa.Column('processing_error', sa.Text(), nullable=True),
        sa.Column('uploaded_by', sa.String(length=36), nullable=False),
        sa.Column('is_receipt', sa.Boolean(), nullable=True, default=True),
        sa.Column('created_at', sa.DateTime(), nullable=False, default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(), nullable=False, default=sa.func.now(), onupdate=sa.func.now()),
        sa.ForeignKeyConstraint(['transaction_id'], ['transactions.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )
    
    # Create indexes for transaction_attachments
    op.create_index('idx_attachments_processed', 'transaction_attachments', ['processed'])
    op.create_index('idx_attachments_transaction', 'transaction_attachments', ['transaction_id'])
    op.create_index('idx_attachments_uploaded_by', 'transaction_attachments', ['uploaded_by'])
    
    # Create transaction_import_batches table
    op.create_table('transaction_import_batches',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('user_id', sa.String(length=36), nullable=False),
        sa.Column('source', sa.String(length=100), nullable=False),
        sa.Column('filename', sa.String(length=255), nullable=True),
        sa.Column('status', sa.String(length=50), nullable=True, default='processing'),
        sa.Column('total_records', sa.Integer(), nullable=True, default=0),
        sa.Column('processed_records', sa.Integer(), nullable=True, default=0),
        sa.Column('successful_imports', sa.Integer(), nullable=True, default=0),
        sa.Column('failed_imports', sa.Integer(), nullable=True, default=0),
        sa.Column('errors', sa.JSON(), nullable=True),
        sa.Column('warnings', sa.JSON(), nullable=True),
        sa.Column('processing_started_at', sa.DateTime(), nullable=True),
        sa.Column('processing_completed_at', sa.DateTime(), nullable=True),
        sa.Column('import_settings', sa.JSON(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False, default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(), nullable=False, default=sa.func.now(), onupdate=sa.func.now()),
        sa.PrimaryKeyConstraint('id')
    )
    
    # Create indexes for transaction_import_batches
    op.create_index('idx_import_batches_created', 'transaction_import_batches', ['created_at'])
    op.create_index('idx_import_batches_status', 'transaction_import_batches', ['status'])
    op.create_index('idx_import_batches_user', 'transaction_import_batches', ['user_id'])


def downgrade() -> None:
    """Drop transaction-related tables"""
    
    # Drop tables in reverse order
    op.drop_table('transaction_import_batches')
    op.drop_table('transaction_attachments')
    op.drop_table('transactions')
    op.drop_table('recurring_transactions')
    op.drop_table('transaction_categories')
    op.drop_table('currencies')
    
    # Drop custom enums
    op.execute('DROP TYPE IF EXISTS transactionstatus')
    op.execute('DROP TYPE IF EXISTS paymentmethod')
    op.execute('DROP TYPE IF EXISTS recurringfrequency')
    op.execute('DROP TYPE IF EXISTS transactiontype')
    op.execute('DROP TYPE IF EXISTS categorytype')