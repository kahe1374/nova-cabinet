# Android AI licensing notes

This document is an engineering checklist, not legal advice.

## Runtime

Alibaba MNN:
- Upstream: https://github.com/alibaba/MNN
- Upstream repository identifies Apache License 2.0.
- Pin the exact revision used for a build.
- Include the Apache-2.0 license text, copyright notices, and applicable NOTICE files when redistributing.
- Audit all bundled dependencies and native libraries independently.

## Baseline model

Stable Diffusion 1.5:
- Upstream model: https://huggingface.co/runwayml/stable-diffusion-v1-5
- Model license: CreativeML OpenRAIL-M.
- Commercial use and redistribution are permitted only subject to the complete license and its restrictions/obligations.
- Include the full license and pass through the applicable use restrictions to users.
- Record the exact model revision and file hashes.

## Fine-tunes and add-ons

Do not assume a fine-tuned checkpoint, VAE, LoRA, ControlNet, upscaler, tokenizer, or conversion is covered by the base model license. Review and record each artifact's own license and provenance before use.

## Excluded source

Do not copy Local Dream source into NOVA's commercial codebase unless the rights holder grants a separate commercial license. The current plan uses MNN as a separate runtime candidate and does not copy Local Dream code.
