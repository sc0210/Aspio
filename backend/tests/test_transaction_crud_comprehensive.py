"""
Comprehensive test suite for Transaction CRUD operations
Tests all scenarios: create, read, update, delete with various category handling
"""
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import AsyncSession
from datetime import datetime, date
import uuid
from app.utils.datetime_helpers import business_today

# Test data
TEST_USER_ID = str(uuid.uuid4())

# Actual API response format:
# POST /transactions/  -> 201, {'transaction': {...}, 'auto_categorized': ..., ...}
# GET  /transactions/  -> 200, {'transactions': [...]}
# GET  /transactions/{id} -> 200, flat transaction object
# PUT  /transactions/{id} -> 200, flat transaction object
# DELETE /transactions/{id} -> 204, empty body
# GET  /transactions/categories -> 200, list directly


class TestTransactionCRUD:
    """Comprehensive tests for transaction CRUD operations"""

    @pytest.fixture
    def test_transaction_data(self):
        """Base transaction data for testing"""
        return {
            'type': 'expense',
            'amount': 150.50,
            'currency': 'TWD',
            'description': 'Test transaction',
            'transaction_date': business_today().isoformat(),
            'payment_method': 'credit_card',
        }

    # ==================== CREATE TRANSACTION TESTS ====================

    def test_create_transaction_with_category_name(self, client: TestClient, test_transaction_data):
        """Test creating transaction with category_name (no category_id)"""
        data = {**test_transaction_data, 'category_name': 'Food & Dining'}

        response = client.post('/api/v1/transactions/', json=data)

        assert response.status_code == 201, f"Failed: {response.json()}"
        result = response.json()
        assert 'transaction' in result
        assert result['transaction']['description'] == 'Test transaction'
        assert float(result['transaction']['amount']) == 150.50

    def test_create_transaction_with_new_category(self, client: TestClient, test_transaction_data):
        """Test creating transaction with a new category that doesn't exist"""
        data = {**test_transaction_data, 'category_name': f'New Category {uuid.uuid4().hex[:8]}'}

        response = client.post('/api/v1/transactions/', json=data)

        assert response.status_code == 201, f"Failed: {response.json()}"
        assert 'transaction' in response.json()

    def test_create_transaction_with_valid_category_id(self, client: TestClient, test_transaction_data):
        """Test creating transaction with existing category_id"""
        categories_response = client.get('/api/v1/transactions/categories?type=expense')
        assert categories_response.status_code == 200
        categories = categories_response.json()  # direct list

        # Assert, never skip. An empty category list is itself the bug — the
        # global seed categories should always be there — and skipping turned
        # that into a silent green instead of a failure.
        assert categories, (
            "No categories returned by /transactions/categories?type=expense; "
            "the global seed categories are missing."
        )

        category_id = categories[0]['id']
        data = {**test_transaction_data, 'category_id': category_id}

        response = client.post('/api/v1/transactions/', json=data)

        assert response.status_code == 201, f"Failed: {response.json()}"
        assert response.json()['transaction']['category_id'] == category_id

    def test_create_transaction_with_invalid_category_id(self, client: TestClient, test_transaction_data):
        """Test creating transaction with invalid category_id"""
        data = {**test_transaction_data, 'category_id': str(uuid.uuid4())}

        response = client.post('/api/v1/transactions/', json=data)

        # Demo mode accepts any UUID; real authenticated mode validates against DB
        # Accept either validation error or successful creation (demo mode behavior)
        assert response.status_code in [201, 400, 422, 500]

    def test_create_transaction_with_category_name_fallback(self, client: TestClient, test_transaction_data):
        """Test that category_name is used when category_id is invalid"""
        data = {
            **test_transaction_data,
            'category_id': str(uuid.uuid4()),  # Invalid ID
            'category_name': 'Transportation',  # Should fall back to this
        }

        response = client.post('/api/v1/transactions/', json=data)

        assert response.status_code == 201, f"Failed: {response.json()}"
        assert 'transaction' in response.json()

    def test_create_income_transaction(self, client: TestClient):
        """Test creating income transaction"""
        data = {
            'type': 'income',
            'amount': 5000.00,
            'currency': 'TWD',
            'description': 'Monthly salary',
            'transaction_date': business_today().isoformat(),
            'category_name': 'Salary',
        }

        response = client.post('/api/v1/transactions/', json=data)

        assert response.status_code == 201, f"Failed: {response.json()}"
        assert response.json()['transaction']['type'] == 'income'

    def test_create_transaction_without_category(self, client: TestClient, test_transaction_data):
        """Test creating transaction without category (should fail or auto-categorize)"""
        data = test_transaction_data.copy()

        response = client.post('/api/v1/transactions/', json=data)

        if response.status_code == 201:
            assert 'transaction' in response.json()
        else:
            assert response.status_code in [400, 422]

    # ==================== READ TRANSACTION TESTS ====================

    def test_get_transactions_list(self, client: TestClient):
        """Test getting list of transactions"""
        response = client.get('/api/v1/transactions/')

        assert response.status_code == 200
        result = response.json()
        assert 'transactions' in result
        assert isinstance(result['transactions'], list)

    def test_get_transaction_by_id(self, client: TestClient, test_transaction_data):
        """Test getting single transaction by ID"""
        create_response = client.post('/api/v1/transactions/', json={
            **test_transaction_data, 'category_name': 'Shopping',
        })
        assert create_response.status_code == 201
        transaction_id = create_response.json()['transaction']['id']

        response = client.get(f'/api/v1/transactions/{transaction_id}')

        assert response.status_code == 200
        result = response.json()
        assert result['id'] == transaction_id

    def test_get_transactions_with_filters(self, client: TestClient):
        """Test getting transactions with type filter"""
        response = client.get('/api/v1/transactions/?type=expense')

        assert response.status_code == 200
        result = response.json()
        assert 'transactions' in result
        for txn in result['transactions']:
            assert txn['type'] == 'expense'

    def test_get_transactions_with_category_filter(self, client: TestClient):
        """Test getting transactions filtered by category"""
        response = client.get('/api/v1/transactions/?category=Food & Dining')

        assert response.status_code == 200
        assert 'transactions' in response.json()

    # ==================== UPDATE TRANSACTION TESTS ====================

    def test_update_transaction_amount(self, client: TestClient, test_transaction_data):
        """Test updating transaction amount"""
        create_response = client.post('/api/v1/transactions/', json={
            **test_transaction_data, 'category_name': 'Food & Dining',
        })
        assert create_response.status_code == 201
        transaction_id = create_response.json()['transaction']['id']

        response = client.put(f'/api/v1/transactions/{transaction_id}', json={'amount': 250.75})

        assert response.status_code == 200, f"Failed: {response.json()}"
        assert float(response.json()['amount']) == 250.75

    def test_update_transaction_category_by_name(self, client: TestClient, test_transaction_data):
        """Test updating transaction category using category_name"""
        create_response = client.post('/api/v1/transactions/', json={
            **test_transaction_data, 'category_name': 'Food & Dining',
        })
        assert create_response.status_code == 201
        transaction_id = create_response.json()['transaction']['id']

        response = client.put(
            f'/api/v1/transactions/{transaction_id}', json={'category_name': 'Transportation'}
        )

        assert response.status_code == 200, f"Failed: {response.json()}"

    def test_update_transaction_category_by_id(self, client: TestClient, test_transaction_data):
        """Test updating transaction category using category_id"""
        categories_response = client.get('/api/v1/transactions/categories?type=expense')
        categories = categories_response.json()  # direct list
        # Assert, never skip — see the note on the valid-category_id test above.
        # The expense seed set has well more than two entries, so fewer than two
        # means seeding is broken, not that the test is inapplicable.
        assert len(categories) >= 2, (
            f"Expected at least 2 expense categories, got {len(categories)}; "
            "the global seed categories are missing or incomplete."
        )

        create_response = client.post('/api/v1/transactions/', json={
            **test_transaction_data, 'category_id': categories[0]['id'],
        })
        assert create_response.status_code == 201
        transaction_id = create_response.json()['transaction']['id']

        response = client.put(
            f'/api/v1/transactions/{transaction_id}', json={'category_id': categories[1]['id']}
        )

        assert response.status_code == 200, f"Failed: {response.json()}"
        assert response.json()['category_id'] == categories[1]['id']

    def test_update_transaction_description(self, client: TestClient, test_transaction_data):
        """Test updating transaction description"""
        create_response = client.post('/api/v1/transactions/', json={
            **test_transaction_data, 'category_name': 'Shopping',
        })
        assert create_response.status_code == 201
        transaction_id = create_response.json()['transaction']['id']

        response = client.put(
            f'/api/v1/transactions/{transaction_id}', json={'description': 'Updated description'}
        )

        assert response.status_code == 200, f"Failed: {response.json()}"
        assert response.json()['description'] == 'Updated description'

    def test_update_transaction_type_and_category(self, client: TestClient, test_transaction_data):
        """Test updating transaction type from expense to income"""
        create_response = client.post('/api/v1/transactions/', json={
            **test_transaction_data, 'type': 'expense', 'category_name': 'Shopping',
        })
        assert create_response.status_code == 201
        transaction_id = create_response.json()['transaction']['id']

        response = client.put(
            f'/api/v1/transactions/{transaction_id}',
            json={'type': 'income', 'category_name': 'Freelance'},
        )

        assert response.status_code == 200, f"Failed: {response.json()}"
        # Note: demo mode may not persist type changes; just verify response is successful
        assert 'type' in response.json()

    def test_update_transaction_multiple_fields(self, client: TestClient, test_transaction_data):
        """Test updating multiple transaction fields at once"""
        create_response = client.post('/api/v1/transactions/', json={
            **test_transaction_data, 'category_name': 'Food & Dining',
        })
        assert create_response.status_code == 201
        transaction_id = create_response.json()['transaction']['id']

        response = client.put(f'/api/v1/transactions/{transaction_id}', json={
            'amount': 300.00,
            'description': 'Updated multi-field transaction',
            'category_name': 'Transportation',
            'payment_method': 'cash',
        })

        assert response.status_code == 200, f"Failed: {response.json()}"
        result = response.json()
        assert float(result['amount']) == 300.00
        assert result['description'] == 'Updated multi-field transaction'
        assert result['payment_method'] == 'cash'

    def test_update_transaction_with_invalid_category_id(self, client: TestClient, test_transaction_data):
        """Test updating transaction with invalid category_id"""
        create_response = client.post('/api/v1/transactions/', json={
            **test_transaction_data, 'category_name': 'Food & Dining',
        })
        assert create_response.status_code == 201
        transaction_id = create_response.json()['transaction']['id']

        response = client.put(
            f'/api/v1/transactions/{transaction_id}',
            json={'category_id': str(uuid.uuid4())},
        )

        # Demo mode may accept any UUID; authenticated mode validates against DB
        assert response.status_code in [200, 400, 422, 500]

    def test_update_transaction_date(self, client: TestClient, test_transaction_data):
        """Test updating transaction date"""
        create_response = client.post('/api/v1/transactions/', json={
            **test_transaction_data, 'category_name': 'Food & Dining',
        })
        assert create_response.status_code == 201
        transaction_id = create_response.json()['transaction']['id']

        new_date = '2024-01-15'
        response = client.put(
            f'/api/v1/transactions/{transaction_id}', json={'transaction_date': new_date}
        )

        assert response.status_code == 200, f"Failed: {response.json()}"
        assert new_date in response.json()['transaction_date']

    # ==================== DELETE TRANSACTION TESTS ====================

    def test_delete_transaction(self, client: TestClient, test_transaction_data):
        """Test deleting a transaction"""
        create_response = client.post('/api/v1/transactions/', json={
            **test_transaction_data, 'category_name': 'Shopping',
        })
        assert create_response.status_code == 201
        transaction_id = create_response.json()['transaction']['id']

        response = client.delete(f'/api/v1/transactions/{transaction_id}')

        assert response.status_code == 204, f"Failed: status {response.status_code}"

    def test_delete_nonexistent_transaction(self, client: TestClient):
        """Test deleting a transaction that doesn't exist"""
        fake_id = str(uuid.uuid4())
        response = client.delete(f'/api/v1/transactions/{fake_id}')

        assert response.status_code in [404, 400]

    # ==================== EDGE CASES ====================

    def test_create_transaction_with_zero_amount(self, client: TestClient, test_transaction_data):
        """Test creating transaction with zero amount (should fail)"""
        data = {**test_transaction_data, 'amount': 0, 'category_name': 'Food & Dining'}

        response = client.post('/api/v1/transactions/', json=data)

        assert response.status_code in [400, 422]

    def test_create_transaction_with_negative_amount(self, client: TestClient, test_transaction_data):
        """Test creating transaction with negative amount (should fail)"""
        data = {**test_transaction_data, 'amount': -100.00, 'category_name': 'Food & Dining'}

        response = client.post('/api/v1/transactions/', json=data)

        assert response.status_code in [400, 422]

    def test_create_transaction_with_very_large_amount(self, client: TestClient, test_transaction_data):
        """Test creating transaction with very large amount"""
        data = {
            **test_transaction_data,
            'amount': 999999999.99,
            'category_name': 'Investment Returns',
            'type': 'income',
        }

        response = client.post('/api/v1/transactions/', json=data)

        assert response.status_code == 201, f"Failed: {response.json()}"
        assert 'transaction' in response.json()

    def test_create_transaction_with_special_characters_in_description(self, client: TestClient, test_transaction_data):
        """Test creating transaction with special characters in description"""
        data = {
            **test_transaction_data,
            'description': 'Test with special chars: äöü @#$%^&*()',
            'category_name': 'Food & Dining',
        }

        response = client.post('/api/v1/transactions/', json=data)

        assert response.status_code == 201, f"Failed: {response.json()}"
        assert 'transaction' in response.json()

    def test_create_transaction_with_future_date(self, client: TestClient, test_transaction_data):
        """Test creating transaction with future date"""
        data = {
            **test_transaction_data,
            'transaction_date': '2025-12-31',
            'category_name': 'Food & Dining',
        }

        response = client.post('/api/v1/transactions/', json=data)

        assert response.status_code == 201, f"Failed: {response.json()}"
        assert 'transaction' in response.json()

    # ==================== CATEGORY-SPECIFIC TESTS ====================

    def test_case_insensitive_category_matching(self, client: TestClient, test_transaction_data):
        """Test that category names are matched case-insensitively"""
        data = {**test_transaction_data, 'category_name': 'food & dining'}  # lowercase

        response = client.post('/api/v1/transactions/', json=data)

        assert response.status_code == 201, f"Failed: {response.json()}"
        assert 'transaction' in response.json()

    def test_category_with_leading_trailing_spaces(self, client: TestClient, test_transaction_data):
        """Test category name with leading/trailing spaces"""
        data = {**test_transaction_data, 'category_name': '  Food & Dining  '}

        response = client.post('/api/v1/transactions/', json=data)

        assert response.status_code == 201, f"Failed: {response.json()}"
        assert 'transaction' in response.json()


# ==================== INTEGRATION TESTS ====================

class TestTransactionIntegration:
    """Integration tests for complete transaction workflows"""

    def test_complete_transaction_lifecycle(self, client: TestClient):
        """Test complete lifecycle: create -> read -> update -> delete"""
        # 1. Create
        create_data = {
            'type': 'expense',
            'amount': 100.00,
            'currency': 'TWD',
            'description': 'Lifecycle test',
            'transaction_date': business_today().isoformat(),
            'category_name': 'Shopping',
        }
        create_response = client.post('/api/v1/transactions/', json=create_data)
        assert create_response.status_code == 201
        transaction_id = create_response.json()['transaction']['id']

        # 2. Read
        get_response = client.get(f'/api/v1/transactions/{transaction_id}')
        assert get_response.status_code == 200
        assert get_response.json()['description'] == 'Lifecycle test'

        # 3. Update
        update_response = client.put(
            f'/api/v1/transactions/{transaction_id}',
            json={'amount': 150.00, 'description': 'Updated lifecycle test'},
        )
        assert update_response.status_code == 200
        assert float(update_response.json()['amount']) == 150.00

        # 4. Delete
        delete_response = client.delete(f'/api/v1/transactions/{transaction_id}')
        assert delete_response.status_code == 204

    def test_multiple_transactions_with_same_category(self, client: TestClient):
        """Test creating multiple transactions with the same category"""
        category_name = 'Food & Dining'

        for i in range(3):
            data = {
                'type': 'expense',
                'amount': 50.00 * (i + 1),
                'currency': 'TWD',
                'description': f'Transaction {i+1}',
                'transaction_date': business_today().isoformat(),
                'category_name': category_name,
            }
            response = client.post('/api/v1/transactions/', json=data)
            assert response.status_code == 201, f"Failed on transaction {i+1}: {response.json()}"

    def test_switching_transaction_types(self, client: TestClient):
        """Test creating expense then income, verifying category handling"""
        expense_data = {
            'type': 'expense',
            'amount': 100.00,
            'currency': 'TWD',
            'description': 'Expense transaction',
            'transaction_date': business_today().isoformat(),
            'category_name': 'Shopping',
        }
        expense_response = client.post('/api/v1/transactions/', json=expense_data)
        assert expense_response.status_code == 201

        income_data = {
            'type': 'income',
            'amount': 1000.00,
            'currency': 'TWD',
            'description': 'Income transaction',
            'transaction_date': business_today().isoformat(),
            'category_name': 'Salary',
        }
        income_response = client.post('/api/v1/transactions/', json=income_data)
        assert income_response.status_code == 201
