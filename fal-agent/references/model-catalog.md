# fal.ai Model Catalog

Complete reference of supported models with endpoint IDs, capabilities, and pricing tiers.

## Image Generation

| Alias | Endpoint ID | Speed | Quality | Notes |
|-------|------------|-------|---------|-------|
| `flux-schnell` | `fal-ai/flux/schnell` | Ultra-fast (1-4 steps) | Good | Best for rapid prototyping |
| `flux-dev` | `fal-ai/flux/dev` | Fast | High | Good balance of speed/quality |
| `flux-pro` | `fal-ai/flux-pro/v1.1-ultra` | Medium | Excellent | Up to 2K resolution |
| `flux-lora` | `fal-ai/flux-lora` | Fast | High | Supports LoRA fine-tuning |
| `recraft-v3` | `fal-ai/recraft/v3` | Medium | Excellent | Best for vector art, logos, typography |
| `ideogram-v3` | `fal-ai/ideogram/v3` | Medium | Excellent | Best text rendering in images |
| `imagen4` | `fal-ai/imagen4/preview` | Medium | Excellent | Google's highest quality model |

### Image Parameters
- `prompt` (required): Text description of desired image
- `image_size`: Preset (`landscape_16_9`, `portrait_16_9`, `square`, `square_hd`) or `{"width": N, "height": N}`
- `num_images`: Number of images (1-4 typically)
- `negative_prompt`: Things to avoid in the image
- `seed`: Reproducibility seed (integer)

## Video Generation

| Alias | Endpoint ID | Type | Duration | Notes |
|-------|------------|------|----------|-------|
| `kling` | `fal-ai/kling/v2.1/pro/text-to-video` | Text→Video | 5-10s | Cinematic, camera controls |
| `kling-img2vid` | `fal-ai/kling/v2.1/pro/image-to-video` | Image→Video | 5-10s | Animate a still image |
| `veo3` | `fal-ai/veo3` | Text→Video | Up to 8s | Highest quality, native audio |
| `veo3-fast` | `fal-ai/veo3/fast` | Text→Video | Up to 8s | Speed-optimized Veo 3 |
| `minimax-video` | `minimax/video-01-live/text-to-video` | Text→Video | 5s | Good quality/cost ratio |
| `minimax-img2vid` | `minimax/hailuo-02/standard/image-to-video` | Image→Video | 5s | 768p resolution |
| `wan` | `fal-ai/wan/v2.7/text-to-video` | Text→Video | 5s | Latest gen, smooth motion |
| `wan-img2vid` | `fal-ai/wan/v2.2-a14b/image-to-video` | Image→Video | 5s | Open-source img2vid |
| `ltx-video` | `fal-ai/ltx-video` | Text→Video | 5s | Fast, open |

### Video Parameters
- `prompt` (required for text-to-video): Text description
- `image_url` (required for image-to-video): Source image URL
- `duration`: Duration string (e.g., `"5s"`, `"10s"`)
- `aspect_ratio`: Ratio string (e.g., `"16:9"`, `"9:16"`, `"1:1"`)

## Audio / Text-to-Speech

| Alias | Endpoint ID | Latency | Languages | Notes |
|-------|------------|---------|-----------|-------|
| `elevenlabs-v3` | `fal-ai/elevenlabs/tts/eleven-v3` | Medium | 29+ | Most expressive, highest quality |
| `elevenlabs-turbo` | `fal-ai/elevenlabs/tts/turbo-v2.5` | Low | English | Optimized for speed |
| `elevenlabs-multilingual` | `fal-ai/elevenlabs/tts/multilingual-v2` | Medium | 29 | Best for non-English |

### Audio Parameters
- `text` (required): Text to speak
- `voice_id`: ElevenLabs voice ID (browse voices at elevenlabs.io)
- `language_code`: ISO language code (e.g., `"en"`, `"es"`, `"fr"`, `"de"`)

## Music Generation

| Alias | Endpoint ID | Duration | Notes |
|-------|------------|----------|-------|
| `minimax-music` | `fal-ai/minimax-music/v2` | Up to 5min | Supports lyrics, multiple genres |

### Music Parameters
- `prompt` (required): Description of the music style, mood, genre
- `lyrics`: Optional lyrics text for the song
- `duration`: Duration of the track

## Transcription

| Alias | Endpoint ID | Languages | Notes |
|-------|------------|-----------|-------|
| `whisper` | `fal-ai/whisper` | 99+ | OpenAI Whisper, word-level timestamps |

### Transcription Parameters
- `audio_url` (required): URL of audio file to transcribe
- `language`: ISO language code hint (improves accuracy)

## Using Custom / Unlisted Models

The `raw` command lets you call any fal.ai endpoint directly:

```bash
python tools/fal_generate.py raw --endpoint "fal-ai/any-model/endpoint" --payload '{"prompt": "hello"}'
```

Browse all 1000+ models at: https://fal.ai/models
