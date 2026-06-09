import sys
try:
    import pywebpush
    from pywebpush import WebPushException
except ImportError:
    print("pywebpush not installed yet")
    sys.exit(1)

import os
import json

# Try to use VAPID tool
try:
    import subprocess
    result = subprocess.run(["vapid", "--gen"], capture_output=True, text=True)
    print("VAPID GEN Output:")
    print(result.stdout)
except Exception as e:
    print("Error:", e)
