# NOVA AI model selection — initial review

Review date: 2026-11-19

## Preferred image-edit candidate

**Qwen-Image-Edit-2511**

- Official model card: https://huggingface.co/Qwen/Qwen-Image-Edit-2511
- The Hugging Face model card identifies the license as Apache 2.0.
- The Qwen Image family is a 20B-parameter model family; full-precision/bfloat16 deployment is therefore a substantial GPU workload.
- Intended capability: instruction-guided image editing with reference-image conditioning.
- This is a candidate for evaluation, not an assertion that NOVA has successfully run it.

## Why it is not installed in the production path yet

1. The project has not established a GPU's available VRAM, CUDA compatibility, or throughput.
2. A model license does not provide free compute or guarantee a free hosted GPU.
3. The exact model revision, inference dependencies, memory profile, and output quality must be tested before adoption.
4. No customer job may be routed to an untested model or marked complete without a real private output upload.

## Evaluation gate

Before enabling this model, run a non-customer benchmark on a temporary/local GPU and record:

- exact model revision and license files;
- GPU model, VRAM, driver, CUDA and PyTorch versions;
- peak VRAM and cold/warm latency;
- input/output dimensions and image quality;
- image-edit consistency on a small approved test set;
- whether quantization/offloading is required and its quality impact.

## Sources

- Qwen-Image-Edit-2511 model card: https://huggingface.co/Qwen/Qwen-Image-Edit-2511
- Qwen-Image-Edit-2509 model card: https://huggingface.co/Qwen/Qwen-Image-Edit-2509
- NVIDIA model overview and deployment notes: https://build.nvidia.com/qwen/qwen-image-edit/modelcard

No weights are downloaded by this repository change. No external inference service is configured.
