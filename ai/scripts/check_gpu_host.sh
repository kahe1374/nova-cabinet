#!/usr/bin/env bash
set -uo pipefail

echo "== NOVA AI host preflight =="
echo "Date (UTC): $(date -u +%FT%TZ)"
echo
echo "-- OS --"
uname -a
if command -v lsb_release >/dev/null 2>&1; then lsb_release -a 2>/dev/null || true; fi
echo
echo "-- RAM --"
if command -v free >/dev/null 2>&1; then free -h; else echo "free command unavailable"; fi
echo
echo "-- NVIDIA GPU --"
if command -v nvidia-smi >/dev/null 2>&1; then
  nvidia-smi --query-gpu=name,memory.total,memory.free,driver_version --format=csv,noheader || true
  echo
  nvidia-smi
else
  echo "nvidia-smi not found; no NVIDIA GPU/driver detected in PATH."
fi
echo
echo "-- CUDA compiler --"
if command -v nvcc >/dev/null 2>&1; then nvcc --version; else echo "nvcc not installed (not required for every prebuilt PyTorch setup)."; fi
echo
echo "-- Python / PyTorch --"
if command -v python3 >/dev/null 2>&1; then
python3 - <<'PY'
import importlib.util, platform, sys
print("Python:", sys.version.replace("\n", " "))
print("Platform:", platform.platform())
if importlib.util.find_spec("torch"):
    import torch
    print("PyTorch:", torch.__version__)
    print("CUDA build:", torch.version.cuda)
    print("CUDA available:", torch.cuda.is_available())
    if torch.cuda.is_available():
        for i in range(torch.cuda.device_count()):
            p = torch.cuda.get_device_properties(i)
            print(f"GPU {i}: {p.name}; VRAM={p.total_memory / 1024**3:.1f} GiB")
else:
    print("PyTorch: not installed (preflight does not install packages).")
PY
else
  echo "python3 not installed."
fi
echo
echo "-- Docker --"
if command -v docker >/dev/null 2>&1; then docker --version; docker compose version 2>/dev/null || true; else echo "Docker not installed."; fi
echo
echo "Preflight complete. This script only reads host information; it installs nothing and changes no settings."
