---
name: fal-media-generator
description: |
  Generate images, videos, audio, music, and speech using fal.ai's unified API. Triggers for: creating AI images, generating videos from text or images, text-to-speech, music generation, audio creation, AI art, video generation, image-to-video, voice synthesis, transcription. Use whenever the user wants to generate any media (image, video, audio, music, speech) via AI models.
---

# Fal.ai Media Generator

Generate images, videos, audio, music, and speech through fal.ai's unified API with 1000+ models.

## Before Starting

1. Is `FAL_KEY` set in the environment? If not, tell the user to set it: `export FAL_KEY=your_key_here` (get one at https://fal.ai/dashboard/keys)
2. What type of media does the user want? (image / video / audio / music / speech)
3. Do they have a specific model preference, or should we pick the best default?
4. Is there a source image/audio involved (image-to-video, speech-to-text, etc.)?

## Setup

Install the Python client if not already available:

```bash
pip install fal-client --break-system-packages
```

## Available Tools

All tools live in the `tools/` directory relative to this skill. Run them via:

```bash
python tools/fal_cli.py <command> [options]
```

Consult `tools/tools.json` for the full tool registry.

### Core Commands

| Command | Purpose | Example |
|---------|---------|---------|
| `generate-image` | Text-to-image | `python tools/fal_cli.py generate-image --prompt "a cat in space" --model flux-schnell` |
| `generate-video` | Text-to-video or image-to-video | `python tools/fal_cli.py generate-video --prompt "ocean waves" --model kling` |
| `generate-audio` | Text-to-speech | `python tools/fal_cli.py generate-audio --text "Hello world" --model elevenlabs-v3` |
| `generate-music` | Music generation | `python tools/fal_cli.py generate-music --prompt "upbeat jazz" --model minimax-music` |
| `transcribe` | Speech-to-text | `python tools/fal_cli.py transcribe --audio-url "https://..." --model whisper` |
| `list-models` | Show available models | `python tools/fal_cli.py list-models --category image` |

### Model Aliases

Rather than memorizing endpoint IDs, use short aliases:

**Image models:** `flux-schnell`, `flux-dev`, `flux-pro`, `recraft-v3`, `ideogram-v3`, `imagen4`
**Video models:** `kling`, `veo3`, `veo3-fast`, `minimax-video`, `wan`, `ltx-video`
**Audio/Speech:** `elevenlabs-v3`, `elevenlabs-turbo`, `elevenlabs-multilingual`
**Music:** `minimax-music`
**Transcription:** `whisper`

## Process

### Step 1: Identify the Task
Parse the user's request to determine: media type, prompt/input, preferred model (or pick best default), and any parameters (resolution, duration, voice, etc.).

### Step 2: Select the Model
Use the model alias table above. If the user doesn't specify, use these defaults:
- **Image:** `flux-schnell` (fast) or `flux-pro` (quality)
- **Video:** `kling` (balanced) or `veo3` (highest quality)
- **Audio/TTS:** `elevenlabs-v3`
- **Music:** `minimax-music`

### Step 3: Run the Generation
Execute the appropriate tool command. The tool handles:
- Authentication via `FAL_KEY` environment variable
- Queue submission and polling (fal uses async queues)
- Progress reporting
- Downloading the result

### Step 4: Deliver the Result
The tool outputs a JSON result with:
- `url` — direct link to the generated media (hosted on fal CDN)
- `local_path` — path to downloaded file (if `--download` flag used)
- `metadata` — generation time, model used, parameters

**Always provide the user with:**
1. A direct link to view/play the media
2. The downloaded file path (copy to workspace folder)
3. Brief metadata (model used, generation time)

### Step 5: Handle Errors
Common issues:
- **Missing FAL_KEY:** Prompt user to set it
- **Model not found:** Show available models with `list-models`
- **Content policy:** Some models reject certain prompts — suggest rewording
- **Timeout:** Video generation can take 1-5 minutes — this is normal

## Quality Gate

- [ ] FAL_KEY is confirmed available before any API call — never expose the key in output
- [ ] Correct model endpoint is used for the media type — never send image prompts to video models
- [ ] Generation result URL is provided to the user — never claim success without a URL
- [ ] Downloaded file is saved to workspace folder — never leave files only in temp directories
- [ ] Error messages are clear and actionable — never show raw stack traces to users

## Constraints

- Maximum prompt length varies by model (typically 500-2000 chars)
- Video generation takes 30s-5min depending on model and length
- Generated media URLs from fal CDN expire (typically 24-72h) — always download important results
- Respect rate limits — if a 429 is returned, wait and retry
- Some models have content safety filters — don't try to bypass them

## Safety Guardrails

<investigate_before_answering>
Never assume a model supports a feature without checking. Verify model capabilities before calling.
</investigate_before_answering>

<action_safety>
Media generation is a non-destructive, reversible action — proceed freely.
API costs are incurred per generation — inform the user if running expensive models (video, high-res).
</action_safety>

## Reference Files

| File | Purpose |
|------|---------|
| `tools/fal_cli.py` | Main CLI tool for all generation tasks |
| `tools/tools.json` | Tool registry with all commands and args |
| `references/model-catalog.md` | Complete model list with endpoint IDs and capabilities |

## Eval Criteria

### Test 1: Happy Path — List Image Models
- Input: `python tools/fal_cli.py list-models --category image`
- Expected: JSON array with model objects containing id, name, category, description; exit code 0

### Test 2: Edge Case — Generate Image with Custom Parameters
- Input: `python tools/fal_cli.py generate-image --prompt "a sunset over mountains" --model flux-schnell --num-inference-steps 20`
- Expected: JSON with url (generated image link), metadata (model, generation_time); exit code 0

### Test 3: Failure Mode — Missing API Key
- Input: `FAL_KEY= python tools/fal_cli.py list-models --category image`
- Expected: JSON error message about missing FAL_KEY, exit code 3
