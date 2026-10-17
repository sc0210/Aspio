"""
Manual Transaction CRUD Test Script
Tests all transaction CRUD operations against running backend
Run this with: python manual_transaction_crud_test.py
"""
import requests
import json
from datetime import date
from typing import Dict, Any
from app.utils.datetime_helpers import business_today

# Backend API base URL
BASE_URL = "http://localhost:8000/api/v1"

# Test results tracker
test_results = {
    'passed': [],
    'failed': [],
    'total': 0
}

def log_test(name: str, passed: bool, details: str = ""):
    """Log test result"""
    test_results['total'] += 1
    if passed:
        test_results['passed'].append(name)
        print(f"✅ PASS: {name}")
        if details:
            print(f"   {details}")
    else:
        test_results['failed'].append(name)
        print(f"❌ FAIL: {name}")
        if details:
            print(f"   {details}")

def test_create_transaction_with_category_name():
    """Test creating transaction with category_name"""
    data = {
        'type': 'expense',
        'amount': 150.50,
        'currency': 'TWD',
        'description': 'Test transaction with category name',
        'transaction_date': business_today().isoformat(),
        'category_name': 'Food & Dining',
        'payment_method': 'credit_card'
    }

    try:
        response = requests.post(f"{BASE_URL}/transactions/", json=data)
        passed = response.status_code in [200, 201]
        result = response.json() if response.status_code in [200, 201] else {}

        if passed:
            details = f"Created transaction ID: {result.get('data', {}).get('id')}"
            log_test("Create transaction with category_name", True, details)
            return result.get('data', {}).get('id')
        else:
            log_test("Create transaction with category_name", False, f"Status: {response.status_code}, Response: {response.text}")
            return None
    except Exception as e:
        log_test("Create transaction with category_name", False, str(e))
        return None

def test_create_transaction_with_new_category():
    """Test creating transaction with a new category"""
    data = {
        'type': 'expense',
        'amount': 200.00,
        'currency': 'TWD',
        'description': 'Test with new category',
        'transaction_date': business_today().isoformat(),
        'category_name': f'Test Category {business_today().isoformat()}',
    }

    try:
        response = requests.post(f"{BASE_URL}/transactions/", json=data)
        passed = response.status_code == 200
        log_test("Create transaction with new category", passed,
                f"Status: {response.status_code}")
        return response.json().get('data', {}).get('id') if passed else None
    except Exception as e:
        log_test("Create transaction with new category", False, str(e))
        return None

def test_get_transactions_list():
    """Test getting list of transactions"""
    try:
        response = requests.get(f"{BASE_URL}/transactions/")
        passed = response.status_code == 200
        if passed:
            data = response.json().get('data', [])
            details = f"Retrieved {len(data)} transactions"
        else:
            details = f"Status: {response.status_code}"
        log_test("Get transactions list", passed, details)
        return passed
    except Exception as e:
        log_test("Get transactions list", False, str(e))
        return False

def test_get_transaction_by_id(transaction_id: str):
    """Test getting single transaction by ID"""
    if not transaction_id:
        log_test("Get transaction by ID", False, "No transaction ID provided")
        return False

    try:
        response = requests.get(f"{BASE_URL}/transactions/{transaction_id}")
        passed = response.status_code == 200
        if passed:
            data = response.json().get('data', {})
            details = f"Retrieved transaction: {data.get('description')}"
        else:
            details = f"Status: {response.status_code}"
        log_test("Get transaction by ID", passed, details)
        return passed
    except Exception as e:
        log_test("Get transaction by ID", False, str(e))
        return False

def test_update_transaction_amount(transaction_id: str):
    """Test updating transaction amount"""
    if not transaction_id:
        log_test("Update transaction amount", False, "No transaction ID provided")
        return False

    data = {'amount': 250.75}

    try:
        response = requests.put(f"{BASE_URL}/transactions/{transaction_id}", json=data)
        passed = response.status_code == 200
        if passed:
            result = response.json().get('data', {})
            details = f"Updated amount to {result.get('amount')}"
        else:
            details = f"Status: {response.status_code}, Response: {response.text}"
        log_test("Update transaction amount", passed, details)
        return passed
    except Exception as e:
        log_test("Update transaction amount", False, str(e))
        return False

def test_update_transaction_category(transaction_id: str):
    """Test updating transaction category by name"""
    if not transaction_id:
        log_test("Update transaction category", False, "No transaction ID provided")
        return False

    data = {'category_name': 'Transportation'}

    try:
        response = requests.put(f"{BASE_URL}/transactions/{transaction_id}", json=data)
        passed = response.status_code == 200
        if passed:
            result = response.json().get('data', {})
            details = f"Updated category to {result.get('category_id')}"
        else:
            details = f"Status: {response.status_code}, Response: {response.text}"
        log_test("Update transaction category", passed, details)
        return passed
    except Exception as e:
        log_test("Update transaction category", False, str(e))
        return False

def test_update_transaction_multiple_fields(transaction_id: str):
    """Test updating multiple fields at once"""
    if not transaction_id:
        log_test("Update multiple fields", False, "No transaction ID provided")
        return False

    data = {
        'amount': 300.00,
        'description': 'Updated multi-field transaction',
        'category_name': 'Shopping',
        'payment_method': 'cash'
    }

    try:
        response = requests.put(f"{BASE_URL}/transactions/{transaction_id}", json=data)
        passed = response.status_code == 200
        if passed:
            result = response.json().get('data', {})
            details = f"Updated to amount={result.get('amount')}, description='{result.get('description')}'"
        else:
            details = f"Status: {response.status_code}, Response: {response.text}"
        log_test("Update multiple fields", passed, details)
        return passed
    except Exception as e:
        log_test("Update multiple fields", False, str(e))
        return False

def test_delete_transaction(transaction_id: str):
    """Test deleting a transaction"""
    if not transaction_id:
        log_test("Delete transaction", False, "No transaction ID provided")
        return False

    try:
        response = requests.delete(f"{BASE_URL}/transactions/{transaction_id}")
        passed = response.status_code == 200
        details = f"Status: {response.status_code}"
        log_test("Delete transaction", passed, details)
        return passed
    except Exception as e:
        log_test("Delete transaction", False, str(e))
        return False

def test_create_income_transaction():
    """Test creating income transaction"""
    data = {
        'type': 'income',
        'amount': 5000.00,
        'currency': 'TWD',
        'description': 'Monthly salary',
        'transaction_date': business_today().isoformat(),
        'category_name': 'Salary'
    }

    try:
        response = requests.post(f"{BASE_URL}/transactions/", json=data)
        passed = response.status_code == 200
        if passed:
            result = response.json().get('data', {})
            details = f"Created income transaction ID: {result.get('id')}"
        else:
            details = f"Status: {response.status_code}, Response: {response.text}"
        log_test("Create income transaction", passed, details)
        return response.json().get('data', {}).get('id') if passed else None
    except Exception as e:
        log_test("Create income transaction", False, str(e))
        return None

def test_case_insensitive_category():
    """Test case-insensitive category matching"""
    data = {
        'type': 'expense',
        'amount': 100.00,
        'currency': 'TWD',
        'description': 'Test case insensitive',
        'transaction_date': business_today().isoformat(),
        'category_name': 'food & dining'  # lowercase
    }

    try:
        response = requests.post(f"{BASE_URL}/transactions/", json=data)
        passed = response.status_code == 200
        log_test("Case-insensitive category matching", passed,
                f"Status: {response.status_code}")
        return response.json().get('data', {}).get('id') if passed else None
    except Exception as e:
        log_test("Case-insensitive category matching", False, str(e))
        return None

def run_all_tests():
    """Run all tests in sequence"""
    print("=" * 60)
    print("TRANSACTION CRUD COMPREHENSIVE MANUAL TESTS")
    print("=" * 60)
    print()

    # Test 1: Create transactions
    print("📝 CREATE TESTS")
    print("-" * 60)
    txn_id_1 = test_create_transaction_with_category_name()
    txn_id_2 = test_create_transaction_with_new_category()
    income_id = test_create_income_transaction()
    case_insensitive_id = test_case_insensitive_category()
    print()

    # Test 2: Read transactions
    print("📖 READ TESTS")
    print("-" * 60)
    test_get_transactions_list()
    if txn_id_1:
        test_get_transaction_by_id(txn_id_1)
    print()

    # Test 3: Update transactions
    print("✏️  UPDATE TESTS")
    print("-" * 60)
    if txn_id_1:
        test_update_transaction_amount(txn_id_1)
        test_update_transaction_category(txn_id_1)
        test_update_transaction_multiple_fields(txn_id_1)
    print()

    # Test 4: Delete transactions
    print("🗑️  DELETE TESTS")
    print("-" * 60)
    if txn_id_2:
        test_delete_transaction(txn_id_2)
    if case_insensitive_id:
        test_delete_transaction(case_insensitive_id)
    if income_id:
        test_delete_transaction(income_id)
    print()

    # Print summary
    print("=" * 60)
    print("TEST SUMMARY")
    print("=" * 60)
    print(f"Total Tests: {test_results['total']}")
    print(f"✅ Passed: {len(test_results['passed'])}")
    print(f"❌ Failed: {len(test_results['failed'])}")
    print()

    if test_results['failed']:
        print("Failed tests:")
        for test_name in test_results['failed']:
            print(f"  - {test_name}")
    else:
        print("🎉 All tests passed!")

    print("=" * 60)

    return len(test_results['failed']) == 0

if __name__ == "__main__":
    success = run_all_tests()
    exit(0 if success else 1)
