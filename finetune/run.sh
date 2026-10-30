#!/usr/bin/env bash
# Entry point inside the Nebius GPU job (pytorch/pytorch CUDA image from Docker Hub). Injected files land under /opt/le;
# the Token Factory key is the injected secret file /opt/le-secrets/NEBIUS_API_KEY, read by gen_data.py only (never exported).
set -euo pipefail
cd /opt/le
if [ -f bundle.b64 ]; then
  python3 -c 'import base64, gzip, json, os
for path, text in json.loads(gzip.decompress(base64.b64decode(open("bundle.b64").read()))).items():
    assert not path.startswith("/") and ".." not in path.split("/"), path
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    open(path, "w", encoding="utf-8").write(text)'
fi
export PIP_ROOT_USER_ACTION=ignore PYTHONUNBUFFERED=1 HF_HOME=/opt/hf TOKENIZERS_PARALLELISM=false
stamp() { echo "[run.sh $(date -u +%H:%M:%S)] $*"; }
stamp "start; $(nvidia-smi --query-gpu=name,memory.total --format=csv,noheader)"
# Training stack and the model download run in the background while data generation (stdlib only) uses the same minutes.
( pip install --quiet --no-cache-dir --disable-pip-version-check --only-binary :all: -r requirements.txt \
  && python3 -c 'from huggingface_hub import snapshot_download as s; s("nvidia/Llama-3.1-Nemotron-Nano-4B-v1.1", revision="d552708a9d575fa8d4a690b988fd870d65279f98", allow_patterns=["*.json","*.safetensors"])' \
  ) > /opt/prep.log 2>&1 &
PREP=$!
stamp "data generation (Token Factory, Nemotron, 16 in flight)"
python3 gen_data.py
stamp "waiting for pip + model download"
wait $PREP || { tail -n 30 /opt/prep.log; exit 1; }
stamp "train + eval"
python3 train_eval.py
stamp "done"
