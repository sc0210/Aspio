#!/usr/bin/env python3
"""
Comprehensive examples for using the Aspiro Transaction API.
Demonstrates all major features including QR payments, categorization, analytics, and more.
"""

import asyncio
import httpx
import json
from datetime import date, datetime, timedelta
from decimal import Decimal

# API Configuration
API_BASE_URL = "http://localhost:8000/api/v1"
AUTH_HEADERS = {
    "Authorization": "Bearer YOUR_JWT_TOKEN_HERE",
    "Content-Type": "application/json"
}

class TransactionAPIExamples:
    """Examples for using the Transaction API"""
    
    def __init__(self, base_url: str = API_BASE_URL, headers: dict = None):
        self.base_url = base_url
        self.headers = headers or AUTH_HEADERS
        self.client = httpx.AsyncClient()

    async def create_basic_transaction(self):
        """Example: Create a basic expense transaction"""
        
        transaction_data = {
            "type": "expense",
            "amount": 25.50,
            "currency": "SGD",
            "description": "Coffee and pastry at local cafe",
            "transaction_date": date.today().isoformat(),
            "category_id": "food-dining-category-id",  # Would be a real UUID
            "payment_method": "credit_card",
            "merchant_name": "Local Coffee House",
            "location": "123 Orchard Road, Singapore",
            "tags": ["coffee", "breakfast", "orchard"],
            "notes": "Meeting with client over coffee",
            "tax_deductible": False,
            "business_expense": True
        }
        
        response = await self.client.post(
            f"{self.base_url}/transactions/",
            json=transaction_data,
            headers=self.headers
        )
        
        print("📝 Basic Transaction Created:")
        print(json.dumps(response.json(), indent=2))
        return response.json()

    async def create_qr_payment_transaction(self):
        """Example: Create a QR payment transaction (Asian payment method)"""
        
        qr_transaction_data = {
            "type": "expense",
            "amount": 45.00,
            "currency": "SGD",
            "description": "Lunch at hawker center",
            "transaction_date": date.today().isoformat(),
            "category_id": "food-dining-category-id",
            "merchant_name": "Maxwell Food Centre",
            "location": "1 Kadayanallur St, Singapore 069184",
            "qr_payment_data": {
                "qr_code": "00020101021126580009SG.PAYNOW010120216+6512345678020806DEMOAPP53037025405128.5062230118ASPIRO DEMO PAYMENT63045B2A",
                "payment_provider": "paynow",
                "merchant_id": "PAYNOW123456",
                "merchant_name": "Maxwell Food Centre",
                "terminal_id": "T001",
                "transaction_ref": "TXN20250113001"
            }
        }
        
        response = await self.client.post(
            f"{self.base_url}/transactions/qr-payment",
            json=qr_transaction_data,
            headers=self.headers
        )
        
        print("📱 QR Payment Transaction Created:")
        print(json.dumps(response.json(), indent=2))
        return response.json()

    async def create_income_transaction(self):
        """Example: Create an income transaction"""
        
        income_data = {
            "type": "income",
            "amount": 3500.00,
            "currency": "SGD",
            "description": "Monthly salary",
            "transaction_date": date.today().isoformat(),
            "category_id": "salary-category-id",
            "payment_method": "bank_transfer",
            "merchant_name": "Tech Company Pte Ltd",
            "reference_id": "SAL202501001",
            "tags": ["salary", "monthly"],
            "notes": "Regular monthly salary payment"
        }
        
        response = await self.client.post(
            f"{self.base_url}/transactions/",
            json=income_data,
            headers=self.headers
        )
        
        print("💰 Income Transaction Created:")
        print(json.dumps(response.json(), indent=2))
        return response.json()

    async def get_transactions_with_filters(self):
        """Example: Get transactions with various filters"""
        
        # Get expenses from last 30 days
        params = {
            "type": "expense",
            "date_from": (date.today() - timedelta(days=30)).isoformat(),
            "date_to": date.today().isoformat(),
            "page": 1,
            "limit": 20,
            "sort_by": "transaction_date",
            "sort_order": "desc"
        }
        
        response = await self.client.get(
            f"{self.base_url}/transactions/",
            params=params,
            headers=self.headers
        )
        
        print("📊 Filtered Transactions:")
        print(json.dumps(response.json(), indent=2))
        return response.json()

    async def search_transactions(self):
        """Example: Search transactions"""
        
        # Search for coffee-related transactions
        params = {
            "search": "coffee",
            "amount_min": 5.00,
            "amount_max": 50.00,
            "payment_methods": "credit_card,grab_pay",
            "page": 1,
            "limit": 10
        }
        
        response = await self.client.get(
            f"{self.base_url}/transactions/",
            params=params,
            headers=self.headers
        )
        
        print("🔍 Search Results:")
        print(json.dumps(response.json(), indent=2))
        return response.json()

    async def auto_categorize_transaction(self):
        """Example: Get auto-categorization suggestions"""
        
        categorization_request = {
            "description": "Grab ride to office",
            "amount": 12.50,
            "merchant_name": "Grab",
            "payment_method": "grab_pay"
        }
        
        response = await self.client.post(
            f"{self.base_url}/transactions/auto-categorize",
            json=categorization_request,
            headers=self.headers
        )
        
        print("🤖 Auto-categorization Suggestions:")
        print(json.dumps(response.json(), indent=2))
        return response.json()

    async def create_recurring_transaction(self):
        """Example: Create a recurring transaction"""
        
        recurring_data = {
            "type": "expense",
            "amount": 50.00,
            "currency": "SGD",
            "category_id": "utilities-category-id",
            "description": "Monthly internet bill",
            "payment_method": "bank_transfer",
            "frequency": "monthly",
            "interval": 1,
            "start_date": date.today().isoformat(),
            "auto_create": True,
            "requires_approval": False,
            "tags": ["utilities", "internet", "recurring"],
            "notes": "Fiber broadband subscription"
        }
        
        response = await self.client.post(
            f"{self.base_url}/transactions/recurring",
            json=recurring_data,
            headers=self.headers
        )
        
        print("🔄 Recurring Transaction Created:")
        print(json.dumps(response.json(), indent=2))
        return response.json()

    async def bulk_create_transactions(self):
        """Example: Bulk create multiple transactions"""
        
        bulk_data = {
            "transactions": [
                {
                    "type": "expense",
                    "amount": 15.80,
                    "currency": "SGD",
                    "description": "Bus fare",
                    "transaction_date": (date.today() - timedelta(days=1)).isoformat(),
                    "category_id": "transportation-category-id",
                    "payment_method": "ezlink_card"
                },
                {
                    "type": "expense",
                    "amount": 8.50,
                    "currency": "SGD",
                    "description": "Hawker lunch",
                    "transaction_date": (date.today() - timedelta(days=1)).isoformat(),
                    "category_id": "food-dining-category-id",
                    "payment_method": "cash"
                },
                {
                    "type": "expense",
                    "amount": 25.00,
                    "currency": "SGD",
                    "description": "Grocery shopping",
                    "transaction_date": (date.today() - timedelta(days=2)).isoformat(),
                    "category_id": "groceries-category-id",
                    "payment_method": "credit_card",
                    "merchant_name": "FairPrice"
                }
            ],
            "skip_duplicates": True,
            "auto_categorize": True
        }
        
        response = await self.client.post(
            f"{self.base_url}/transactions/bulk",
            json=bulk_data,
            headers=self.headers
        )
        
        print("📦 Bulk Transactions Created:")
        print(json.dumps(response.json(), indent=2))
        return response.json()

    async def get_transaction_analytics(self):
        """Example: Get comprehensive transaction analytics"""
        
        # Get analytics for last 30 days
        params = {
            "period": "30d"
        }
        
        response = await self.client.get(
            f"{self.base_url}/transactions/analytics/summary",
            params=params,
            headers=self.headers
        )
        
        print("📈 Transaction Analytics:")
        print(json.dumps(response.json(), indent=2))
        return response.json()

    async def get_transaction_categories(self):
        """Example: Get transaction categories"""
        
        # Get all active categories
        response = await self.client.get(
            f"{self.base_url}/transactions/categories",
            headers=self.headers
        )
        
        print("📋 Transaction Categories:")
        print(json.dumps(response.json(), indent=2))
        return response.json()

    async def get_popular_categories(self):
        """Example: Get user's popular categories"""
        
        params = {
            "type": "expense",
            "limit": 10
        }
        
        response = await self.client.get(
            f"{self.base_url}/transactions/categories/popular",
            params=params,
            headers=self.headers
        )
        
        print("⭐ Popular Categories:")
        print(json.dumps(response.json(), indent=2))
        return response.json()

    async def upload_receipt(self, transaction_id: str):
        """Example: Upload a receipt to a transaction"""
        
        # In a real scenario, you'd read an actual image file
        files = {
            'file': ('receipt.jpg', b'fake_image_data', 'image/jpeg')
        }
        
        params = {
            'is_receipt': True
        }
        
        response = await self.client.post(
            f"{self.base_url}/transactions/{transaction_id}/attachments",
            files=files,
            params=params,
            headers={k: v for k, v in self.headers.items() if k != "Content-Type"}  # Remove content-type for file upload
        )
        
        print("📎 Receipt Uploaded:")
        print(json.dumps(response.json(), indent=2))
        return response.json()

    async def scan_receipt_for_data(self):
        """Example: Scan a receipt to extract transaction data"""
        
        # In a real scenario, you'd read an actual image file
        files = {
            'file': ('receipt.jpg', b'fake_image_data', 'image/jpeg')
        }
        
        response = await self.client.post(
            f"{self.base_url}/transactions/scan-receipt",
            files=files,
            headers={k: v for k, v in self.headers.items() if k != "Content-Type"}
        )
        
        print("🔍 Receipt Scan Results:")
        print(json.dumps(response.json(), indent=2))
        return response.json()

    async def export_transactions_csv(self):
        """Example: Export transactions to CSV"""
        
        params = {
            "date_from": (date.today() - timedelta(days=90)).isoformat(),
            "date_to": date.today().isoformat()
        }
        
        response = await self.client.get(
            f"{self.base_url}/transactions/export/csv",
            params=params,
            headers=self.headers
        )
        
        print("📄 CSV Export:")
        print(f"Content-Type: {response.headers.get('content-type')}")
        print(f"Content-Disposition: {response.headers.get('content-disposition')}")
        print(f"Data length: {len(response.content)} bytes")
        
        # Save to file
        with open("exported_transactions.csv", "wb") as f:
            f.write(response.content)
        
        return response.content

    async def update_transaction(self, transaction_id: str):
        """Example: Update an existing transaction"""
        
        update_data = {
            "description": "Updated: Coffee meeting with client",
            "category_id": "business-meals-category-id",
            "tags": ["coffee", "business", "client-meeting"],
            "business_expense": True,
            "reviewed_by_user": True
        }
        
        response = await self.client.put(
            f"{self.base_url}/transactions/{transaction_id}",
            json=update_data,
            headers=self.headers
        )
        
        print("✏️ Transaction Updated:")
        print(json.dumps(response.json(), indent=2))
        return response.json()

    async def demonstrate_multi_currency_transaction(self):
        """Example: Create transactions in different Asian currencies"""
        
        transactions = [
            {
                "type": "expense",
                "amount": 150.00,
                "currency": "MYR",
                "description": "Dinner in Kuala Lumpur",
                "transaction_date": date.today().isoformat(),
                "category_id": "food-dining-category-id",
                "payment_method": "touch_n_go",
                "location": "Kuala Lumpur, Malaysia"
            },
            {
                "type": "expense", 
                "amount": 500.00,
                "currency": "THB",
                "description": "Shopping in Bangkok",
                "transaction_date": date.today().isoformat(),
                "category_id": "shopping-category-id",
                "payment_method": "line_pay",
                "location": "Bangkok, Thailand"
            },
            {
                "type": "expense",
                "amount": 1200.00,
                "currency": "PHP",
                "description": "Hotel in Manila",
                "transaction_date": date.today().isoformat(),
                "category_id": "travel-category-id",
                "payment_method": "gcash",
                "location": "Manila, Philippines"
            }
        ]
        
        print("🌏 Multi-currency Transactions:")
        
        for transaction_data in transactions:
            response = await self.client.post(
                f"{self.base_url}/transactions/",
                json=transaction_data,
                headers=self.headers
            )
            print(f"  {transaction_data['currency']} {transaction_data['amount']}: {response.status_code}")

    async def close(self):
        """Close the HTTP client"""
        await self.client.aclose()


async def run_all_examples():
    """Run all transaction API examples"""
    
    examples = TransactionAPIExamples()
    
    try:
        print("🚀 Running Aspiro Transaction API Examples\n")
        
        # Basic transaction operations
        print("=" * 50)
        print("BASIC TRANSACTION OPERATIONS")
        print("=" * 50)
        
        basic_transaction = await examples.create_basic_transaction()
        print()
        
        await examples.create_income_transaction()
        print()
        
        # QR Payment example
        print("=" * 50)
        print("ASIAN PAYMENT METHODS")
        print("=" * 50)
        
        await examples.create_qr_payment_transaction()
        print()
        
        await examples.demonstrate_multi_currency_transaction()
        print()
        
        # Search and filtering
        print("=" * 50)
        print("SEARCH AND FILTERING")
        print("=" * 50)
        
        await examples.get_transactions_with_filters()
        print()
        
        await examples.search_transactions()
        print()
        
        # Auto-categorization
        print("=" * 50)
        print("AUTO-CATEGORIZATION")
        print("=" * 50)
        
        await examples.auto_categorize_transaction()
        print()
        
        # Categories
        print("=" * 50)
        print("CATEGORIES")
        print("=" * 50)
        
        await examples.get_transaction_categories()
        print()
        
        await examples.get_popular_categories()
        print()
        
        # Recurring transactions
        print("=" * 50)
        print("RECURRING TRANSACTIONS")
        print("=" * 50)
        
        await examples.create_recurring_transaction()
        print()
        
        # Bulk operations
        print("=" * 50)
        print("BULK OPERATIONS")
        print("=" * 50)
        
        await examples.bulk_create_transactions()
        print()
        
        # Analytics
        print("=" * 50)
        print("ANALYTICS")
        print("=" * 50)
        
        await examples.get_transaction_analytics()
        print()
        
        # File operations
        print("=" * 50)
        print("FILE OPERATIONS")
        print("=" * 50)
        
        await examples.scan_receipt_for_data()
        print()
        
        # Upload receipt (requires transaction ID)
        if basic_transaction and 'data' in basic_transaction:
            transaction_id = basic_transaction['data']['id']
            await examples.upload_receipt(transaction_id)
            print()
            
            # Update the transaction
            await examples.update_transaction(transaction_id)
            print()
        
        # Export
        await examples.export_transactions_csv()
        print()
        
        print("✅ All examples completed successfully!")
        
    except Exception as e:
        print(f"❌ Error running examples: {str(e)}")
        import traceback
        traceback.print_exc()
    
    finally:
        await examples.close()


if __name__ == "__main__":
    print("""
    🌟 Aspiro Transaction API Examples
    
    This script demonstrates the comprehensive transaction management system
    designed specifically for Asian personal finance markets.
    
    Features demonstrated:
    - Multi-currency transactions (SGD, MYR, THB, PHP, etc.)
    - Asian payment methods (PayNow, GrabPay, Touch'n Go, etc.)
    - QR code payment processing
    - Automatic categorization with ML
    - Receipt OCR and data extraction
    - Advanced search and filtering
    - Transaction analytics and reporting
    - Bulk operations and CSV import/export
    - Recurring transaction management
    
    Note: Update the AUTH_HEADERS with a valid JWT token before running.
    """)
    
    asyncio.run(run_all_examples())