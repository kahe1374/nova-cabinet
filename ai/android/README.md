# NOVA AI — Android on-device evaluation

## Decision

Use **Alibaba MNN Diffusion** as the first Android runtime candidate instead of copying or forking Local Dream.

- Runtime source: https://github.com/alibaba/MNN
- Diffusion guide: https://github.com/alibaba/MNN/blob/master/transformers/diffusion/README.md
- Runtime license: Apache-2.0 (verify the exact checked-out revision and bundled third-party notices before redistribution).
- Supported path documented upstream: Android build, Stable Diffusion 1.5, CPU or OpenCL backend.
- The Android runtime and model weights are separate licensed components.

This is an evaluation track, not a completed APK. No MNN source, model weights, APK, or third-party app code is copied into this repository by this change.

## Model candidate

Start with the original Stable Diffusion 1.5 weights only after reviewing and accepting the complete CreativeML OpenRAIL-M license and model terms:

https://huggingface.co/runwayml/stable-diffusion-v1-5

The license permits commercial use subject to its use restrictions and redistribution obligations. Keep the full license and required notices with any distributed model package. Do not assume every community fine-tune (including photorealistic checkpoints) has the same license.

## Target phone profile

The current test target is an Android phone reported as 6 GB RAM. The exact chipset, free RAM, Android version, and available storage must be measured on the device before choosing an acceleration backend.

Initial conservative test profile:
- 384x384 output first; only try 512x512 if memory and thermal behavior are acceptable.
- 10 denoising iterations for the first baseline, matching the upstream MNN demo interface.
- Try CPU first for a reliable baseline, then OpenCL if the device exposes a working driver.
- One generation at a time; close other heavy apps and allow the phone to cool between runs.
- Record elapsed time, peak memory if measurable, device temperature, crashes, and visual quality.

Do not promise a particular generation time or quality before a real device test.

## Build direction

Follow the official MNN Android diffusion instructions rather than inventing a custom inference implementation:

1. Pin an MNN Git commit/release and record its Apache-2.0 license and third-party notices.
2. Build the Android native library and diffusion demo with the official Android build scripts and NDK version required by that pinned revision.
3. Convert/download the chosen SD 1.5 checkpoint into the exact MNN model package expected by that revision. Preserve model license and provenance.
4. Package the runtime and model as separately versioned assets.
5. Add a minimal NOVA Android UI that calls the native inference layer. Keep inference offline and on-device.
6. Benchmark on the actual phone before deciding whether the mobile engine is suitable for cabinet visualization.

Upstream Android build documentation:
https://github.com/alibaba/MNN/wiki/diffusion

Upstream diffusion guide:
https://github.com/alibaba/MNN/blob/master/transformers/diffusion/README.md

## Important limits

- This commit does not create or install an APK.
- It does not download model weights.
- It does not connect to GitHub from the Android app.
- It does not change the production website, Appwrite, Supabase, or existing self-hosted gateway.
- Local inference may be slow or fail on this phone; the 6 GB RAM figure alone does not establish compatibility.
- Stable Diffusion 1.5 is a baseline for testing, not a cabinet-specialized model. Geometry, handles, drawer spacing, and exact dimensions must be evaluated carefully.
- Never put GitHub tokens, Appwrite keys, FAL keys, or customer data in the Android app or repository.

## Acceptance criteria

The mobile prototype is not considered ready until:
- a debug APK builds reproducibly from pinned source;
- the app launches on the target phone;
- one text-to-image job completes fully offline;
- a second run succeeds without app restart;
- no secrets or customer images leave the device;
- output quality and performance are recorded against a fixed cabinet prompt;
- all runtime, model, and dependency licenses are documented.
