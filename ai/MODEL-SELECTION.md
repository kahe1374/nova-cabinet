# NOVA AI model selection — initial review

Review date: 2026-11-19

## Preferred image-edit candidate

**Qwen-Image-Edit-2511**

- Official model card: https://huggingface.co/Qwen/Qwen-Image-Edit-2511
- The model family is identified as Apache 2.0 in the official model resources; re-check the exact repository license files and every auxiliary component at the pinned revision before commercial deployment.
- Model size: approximately 20B parameters. Full precision is not a realistic assumption for a small/free GPU host.
- Intended capability: instruction-guided image editing with reference-image conditioning and improved subject consistency.
- This is a candidate for evaluation, not an assertion that NOVA has successfully run it.

## Hardware evidence and limitations

- NVIDIA's model card lists H100 as its test hardware for the SGLang Diffusion integration; it does not publish a universal minimum VRAM figure.
- The upstream Qwen project documents low-memory community implementations, including layer-by-layer offload, but those are separate implementations and can be substantially slower.
- An independent 16GB GPU benchmark reports Qwen-Image-Edit-2511 running with INT8 and a four-step Lightning workflow at approximately 15.4GB peak VRAM. This is a single third-party benchmark, not an official minimum requirement and not a guarantee for NOVA's environment.
- Other memory estimates vary substantially with precision, offloading, image size, implementation, and whether the text encoder is resident on the GPU. Never use one number as a universal requirement.

## Why it is not installed in the production path yet

1. The project has not established the actual GPU, available VRAM, driver, CUDA/PyTorch compatibility, or throughput of the target host.
2. A model license does not provide free compute or guarantee a free hosted GPU.
3. The exact model revision, all dependency licenses, inference dependencies, memory profile, and output quality must be tested before adoption.
4. No customer job may be routed to an untested model or marked complete without a real private output upload.
5. Do not upload customer photos to public notebooks or free GPU demos. Use only synthetic or explicitly approved test images.

## Next evaluation procedure

1. Run `bash ai/scripts/check_gpu_host.sh` on the intended host. The script is read-only and does not install software.
2. Record GPU model, VRAM, driver, CUDA and PyTorch versions.
3. Choose a pinned inference implementation and model revision; review its license separately from the model license.
4. Benchmark only synthetic/approved test images. Record peak VRAM, cold/warm latency, image size, and failures.
5. Compare edits for cabinet geometry, door/drawer count, handles, material, color, perspective, and preservation of the original room.
6. Keep the production payment gate and Appwrite private-storage flow unchanged until the complete end-to-end path is security-reviewed.

## Benchmark record template

- Host / date:
- GPU / total VRAM:
- Driver / CUDA / PyTorch:
- Inference engine + pinned commit:
- Model revision + license:
- Quantization / offload / LoRA:
- Input resolution:
- Peak VRAM:
- Cold start:
- Warm inference time:
- OOM / retries:
- Geometry preservation score:
- Material/color fidelity:
- Output stored privately: yes/no

## Sources

- Qwen upstream project and low-memory implementation notes: https://github.com/QwenLM/Qwen-Image
- NVIDIA model card (SGLang Diffusion; H100 test hardware): https://build.nvidia.com/qwen/qwen-image-edit/modelcard
- Independent 16GB INT8/Lightning benchmark (not an official minimum): https://vram16.ullu-egg.com/en/models/qwen-image-edit-2511/
- Qwen-Image-Edit-2511 model card: https://huggingface.co/Qwen/Qwen-Image-Edit-2511

No weights are downloaded by this repository change. No external inference service is configured. No production system is changed.
