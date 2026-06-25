#!/usr/bin/env python3
"""Submit a fal request to the queue and print URLs immediately. No polling."""
import json
import os
import sys
from pathlib import Path

# Reuse the loader and client from the existing CLI
sys.path.insert(0, str(Path(__file__).resolve().parent))
from fal_cli import load_dotenv, FalClient

load_dotenv()

if len(sys.argv) < 3:
    print("usage: submit_only.py <endpoint> <payload-json>", file=sys.stderr)
    sys.exit(2)

endpoint = sys.argv[1]
payload = json.loads(sys.argv[2])

api_key = os.environ.get("FAL_KEY")
if not api_key:
    print(json.dumps({"error": "FAL_KEY not set"}))
    sys.exit(3)

client = FalClient(api_key)
sub = client.submit(endpoint, payload)
print(json.dumps(sub, indent=2))
