## Simulated short playtest (scenario B: 10 calls, 34 caller turns, 44 voice responses, 11 texts)

Scenario fit to the export (mean absolute error across the six Realtime buckets): A 40% (cost -6%), B 10% (cost 4%).

| Variant | Voice | Text | Transcription | Total | text-in/response | text prompt avg (max) |
|---|---:|---:|---:|---:|---:|---:|
| Baseline as simulated (legacy prompts, gpt-realtime) | $0.5053 | $0.0072 | $0.0027 | **$0.5152** | 1604 | 1460 (1678) |
| Model swap only (legacy prompts, gpt-realtime-2.1-mini) | $0.1419 | $0.0072 | $0.0027 | **$0.1518** | 1604 | 1460 (1678) |
| Implemented (bounded prompts + tools, 2.1-mini) | $0.1371 | $0.0031 | $0.0027 | **$0.1429** | 1002 | 525 (644) |
|   ...with cross-session prefix cache hits | $0.1371 | $0.0031 | $0.0027 | **$0.1429** | 1002 | 525 (644) |
| Experiment: stable voice prefix padded to 1,100 tokens | $0.1394 | $0.0031 | $0.0027 | **$0.1451** | 1321 | 525 (644) |
|   ...padded + cross-session cache hits | $0.1366 | $0.0031 | $0.0027 | **$0.1424** | 1321 | 525 (644) |
| Sensitivity: +100 reasoning tokens / response | $0.1477 | $0.0031 | $0.0027 | **$0.1534** | 1002 | 525 (644) |
| Sensitivity: replies 20% shorter (untested) | $0.1218 | $0.0031 | $0.0027 | **$0.1275** | 1002 | 525 (644) |

Excludes one-time TTS asset generation ($0.01212 in the export).

## Calibration: simulated baseline vs the real export (gpt-realtime buckets)

| Bucket | Export | Simulated | Diff |
|---|---:|---:|---:|
| textIn | 16827 | 17498 | 4% |
| textInCached | 53312 | 53069 | 0% |
| textOut | 1057 | 658 | -38% |
| audioIn | 4335 | 5017 | 16% |
| audioInCached | 3136 | 3123 | 0% |
| audioOut | 3791 | 3778 | 0% |
| cost | $0.4881 | $0.5053 | 4% |

## Expensive tail: one player who keeps talking to Ruth

| Variant | Cost | Responses |
|---|---:|---:|
| before: in-app call, 240 s cap (gpt-realtime) | $0.4464 | 33 |
| before: phone call in, no cap, 8 min (gpt-realtime) | $0.9494 | 66 |
| after: 240 s cap, no wrap-up (2.1-mini) | $0.1430 | 33 |
| after: wrap-up at 200 s, goodbye, hang-up (implemented) | $0.1225 | 29 |
| experiment: + retention-ratio truncation (2,000 tokens, 0.6) | $0.1382 | 29 |

Scripted midnight reveal per player: live on 2.1-mini $0.0182 vs recording $0.0000.

Chained pipeline projection for the same playtest (STT + gpt-4.1-mini + gpt-4o-mini-tts): $0.0688 (STT $0.0041, LLM $0.0160, TTS $0.0487); not implemented: adds 1-2 s per turn and loses native barge-in.
