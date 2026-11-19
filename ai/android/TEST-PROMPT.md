# NOVA Android baseline image test

Use the same prompt and settings for every runtime/model comparison.

## Prompt

Modern functional kitchen interior, straight-on front view of a wall of fitted kitchen cabinets, matte warm-white flat-panel doors, natural light-oak lower cabinets, consistent narrow 3 mm reveals, exactly aligned drawer fronts, realistic cabinet depth, straight vertical lines, accurate perspective, concealed hinges, subtle integrated handles, neutral studio lighting, photorealistic architectural interior photograph, no people, no text, no watermark.

## Negative prompt (if supported)

warped cabinet doors, uneven drawer gaps, extra handles, floating shelves, curved walls, distorted perspective, duplicate doors, asymmetrical layout, text, watermark, blurry image, low resolution.

## First baseline

- Resolution: 384x384
- Steps: 10 (match the initial upstream MNN demo baseline)
- Seed: 42
- Batch: 1
- Backend: CPU, then OpenCL if supported
- Save the exact app/runtime/model version and generation time.

## Score each result from 1 to 5

1. Cabinet geometry and straight lines
2. Door/drawer count consistency
3. Handle placement and alignment
4. Material realism (paint and wood grain)
5. Perspective and overall photographic quality

A visually attractive image is not automatically a technically accurate cabinet design. Record geometry errors separately from realism.
