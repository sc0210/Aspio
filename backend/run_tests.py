#!/usr/bin/env python3
"""
Test runner for all Aspiro backend tests.

This script runs all test suites including:
1. Mode isolation tests
2. Database operation tests
3. API endpoint tests
4. Integration tests
"""

import subprocess
import sys
import os
from pathlib import Path


def run_command(command, description):
    """Run a command and return success status."""
    print(f"\n{'='*60}")
    print(f"Running: {description}")
    print(f"Command: {command}")
    print(f"{'='*60}")

    try:
        result = subprocess.run(
            command,
            shell=True,
            check=True,
            capture_output=True,
            text=True
        )
        print("✅ PASSED")
        print(result.stdout)
        return True
    except subprocess.CalledProcessError as e:
        print("❌ FAILED")
        print(f"Exit code: {e.returncode}")
        print(f"STDOUT:\n{e.stdout}")
        print(f"STDERR:\n{e.stderr}")
        return False


def main():
    """Run all test suites."""
    print("🚀 Starting Aspiro Backend Test Suite")

    # Change to backend directory
    backend_dir = Path(__file__).parent
    os.chdir(backend_dir)

    # Test commands to run
    test_commands = [
        {
            "command": "python -m pytest tests/test_mode_isolation.py -v",
            "description": "Mode Isolation Tests"
        },
        {
            "command": "python -m pytest tests/test_database_operations.py -v",
            "description": "Database Operation Tests"
        },
        {
            "command": "python -m pytest tests/test_api_endpoints.py -v",
            "description": "API Endpoint Tests"
        },
        {
            "command": "python -m pytest tests/ -v --tb=short",
            "description": "All Backend Tests"
        }
    ]

    # Run each test suite
    results = []
    for test in test_commands:
        success = run_command(test["command"], test["description"])
        results.append((test["description"], success))

    # Summary
    print(f"\n{'='*60}")
    print("TEST SUMMARY")
    print(f"{'='*60}")

    passed = 0
    failed = 0

    for description, success in results:
        status = "✅ PASSED" if success else "❌ FAILED"
        print(f"{description:<40} {status}")

        if success:
            passed += 1
        else:
            failed += 1

    print(f"\nTotal: {len(results)} test suites")
    print(f"Passed: {passed}")
    print(f"Failed: {failed}")

    if failed > 0:
        print("\n❌ Some tests failed. Please check the output above.")
        sys.exit(1)
    else:
        print("\n🎉 All tests passed!")
        sys.exit(0)


if __name__ == "__main__":
    main()