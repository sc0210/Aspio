#!/usr/bin/env python3
"""
Comprehensive test script for Goals API endpoints.
Tests all implemented CRUD operations and additional endpoints.

NOTE: This is a manual test script intended to run against a live server.
It is NOT a pytest test file and should not be collected by pytest.
"""

import pytest
pytestmark = pytest.mark.skip(reason="Manual test script — requires live server at localhost:8000")

import requests
import json
import sys
from datetime import datetime

BASE_URL = "http://localhost:8000/api/v1/goals"

def test_endpoint(method, endpoint, data=None, expected_status=200):
    """Test an API endpoint and return the result."""
    url = f"{BASE_URL}{endpoint}"
    headers = {"Content-Type": "application/json"}

    try:
        if method.upper() == "GET":
            response = requests.get(url, headers=headers)
        elif method.upper() == "POST":
            response = requests.post(url, headers=headers, json=data)
        elif method.upper() == "PUT":
            response = requests.put(url, headers=headers, json=data)
        elif method.upper() == "DELETE":
            response = requests.delete(url, headers=headers)
        else:
            return False, f"Unsupported method: {method}"

        success = response.status_code == expected_status
        result = response.json() if response.headers.get('content-type', '').startswith('application/json') else response.text

        return success, {
            "status_code": response.status_code,
            "response": result
        }
    except requests.exceptions.RequestException as e:
        return False, f"Request failed: {str(e)}"
    except json.JSONDecodeError as e:
        return False, f"JSON decode error: {str(e)}"

def run_tests():
    """Run comprehensive API tests."""
    tests = [
        {
            "name": "Health Check",
            "method": "GET",
            "endpoint": "/health",
            "expected_status": 200
        },
        {
            "name": "Get Goals (Demo Mode)",
            "method": "GET",
            "endpoint": "/",
            "expected_status": 200
        },
        {
            "name": "Get Goals Statistics",
            "method": "GET",
            "endpoint": "/stats",
            "expected_status": 200
        },
        {
            "name": "Get Goal Templates",
            "method": "GET",
            "endpoint": "/templates",
            "expected_status": 200
        },
        {
            "name": "Create New Goal",
            "method": "POST",
            "endpoint": "/",
            "data": {
                "title": "Test Investment Goal",
                "description": "Test goal for API verification",
                "target_amount": 15000.00,
                "currency": "USD",
                "target_date": "2026-06-30",
                "goal_type": "investment",
                "priority": "medium"
            },
            "expected_status": 201
        },
        {
            "name": "Get Specific Goal (goal_001)",
            "method": "GET",
            "endpoint": "/goal_001",
            "expected_status": 200
        },
        {
            "name": "Update Goal",
            "method": "PUT",
            "endpoint": "/goal_001",
            "data": {
                "title": "Updated Emergency Fund",
                "target_amount": 12000.00
            },
            "expected_status": 200
        },
        {
            "name": "Get Non-existent Goal",
            "method": "GET",
            "endpoint": "/goal_999",
            "expected_status": 404
        },
        {
            "name": "Delete Goal",
            "method": "DELETE",
            "endpoint": "/goal_002",
            "expected_status": 200
        }
    ]

    print("🚀 Starting Goals API Comprehensive Test Suite")
    print("=" * 60)

    passed = 0
    failed = 0

    for i, test in enumerate(tests, 1):
        print(f"\n{i}. Testing: {test['name']}")
        print(f"   {test['method']} {BASE_URL}{test['endpoint']}")

        success, result = test_endpoint(
            test['method'],
            test['endpoint'],
            test.get('data'),
            test['expected_status']
        )

        if success:
            print(f"   ✅ PASSED - Status: {result['status_code']}")
            if 'response' in result and isinstance(result['response'], dict):
                if 'success' in result['response']:
                    print(f"   📊 Response: success={result['response']['success']}")
                if 'mode' in result['response']:
                    print(f"   🔧 Mode: {result['response']['mode']}")
            passed += 1
        else:
            print(f"   ❌ FAILED - {result}")
            failed += 1

    print("\n" + "=" * 60)
    print(f"📊 Test Results: {passed} passed, {failed} failed")

    if failed == 0:
        print("🎉 All tests passed! Goals API is working correctly.")
        return True
    else:
        print("⚠️  Some tests failed. Check the API implementation.")
        return False

if __name__ == "__main__":
    success = run_tests()
    sys.exit(0 if success else 1)