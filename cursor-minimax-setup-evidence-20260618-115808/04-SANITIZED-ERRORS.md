# 04 — Sanitized API Responses

Endpoint: https://api.minimax.io/v1/chat/completions

### MiniMax-M3
- status: PASS
- note: HTTP 200 with completion content
```json
{"id":"06831089039ba716163002c8eb028bfa","choices":[{"finish_reason":"length","index":0,"message":{"content":"<think>\nThe user is asking me to reply with exactly: MINIMAX_CURSOR_TEST_OK\n\nThis appears to be a test message. I should comply with the\n</think>\n","role":"assistant","name":"MiniMax AI","audio_content":""}}],"created":1781783945,"model":"MiniMax-M3","object":"chat.completion","usage":{"total_tokens":220,"total_characters":0,"prompt_tokens":188,"completion_tokens":32,"prompt_tokens_details":{"cached_tokens":114}},"input_sensitive":false,"output_sensitive":false,"input_sensitive_type":0,"output_sensitive_type":0,"output_sensitive_int":0,"service_tier":"standard","base_resp":{"status_code":0,"status_msg":""}}

```

### MiniMax-M2.7
- status: PASS
- note: HTTP 200 with completion content
```json
{"id":"0683108a26a15f95fbb249665e0801c4","choices":[{"finish_reason":"length","index":0,"message":{"content":"<think>\nThe user is asking me to reply with exactly \"MINIMAX_CURSOR_TEST_OK\". This is a simple request that doesn't conflict with my guidelines.\n</think>\n","role":"assistant","name":"MiniMax AI","audio_content":""}}],"created":1781783946,"model":"MiniMax-M2.7","object":"chat.completion","usage":{"total_tokens":64,"total_characters":0,"prompt_tokens":32,"completion_tokens":32,"completion_tokens_details":{"reasoning_tokens":32}},"input_sensitive":false,"output_sensitive":false,"input_sensitive_type":0,"output_sensitive_type":0,"output_sensitive_int":0,"base_resp":{"status_code":0,"status_msg":""}}

```

### MiniMax-M2.7-highspeed
- status: PASS
- note: HTTP 200 with completion content
```json
{"id":"0683108b92d47dae87b4fdafa8a523a4","choices":[{"finish_reason":"length","index":0,"message":{"content":"<think>\nThe user is asking me to reply with exactly the text \"MINIMAX_CURSOR_TEST_OK\". This appears to be a simple test message, likely\n</think>\n","role":"assistant","name":"MiniMax AI","audio_content":""}}],"created":1781783947,"model":"MiniMax-M2.7-highspeed","object":"chat.completion","usage":{"total_tokens":64,"total_characters":0,"prompt_tokens":32,"completion_tokens":32,"completion_tokens_details":{"reasoning_tokens":32}},"input_sensitive":false,"output_sensitive":false,"input_sensitive_type":0,"output_sensitive_type":0,"output_sensitive_int":0,"base_resp":{"status_code":0,"status_msg":""}}

```

### MiniMax-M2.5
- status: PASS
- note: HTTP 200 with completion content
```json
{"id":"0683108da86b1b88d351f9bc58c5baf0","choices":[{"finish_reason":"length","index":0,"message":{"content":"<think>The user is asking me to reply with exactly: MINIMAX_CURSOR_TEST_OK\n\nThis appears to be a simple test message request. I should just respond</think>\n\n","role":"assistant"}}],"created":1781783950,"model":"MiniMax-M2.5","object":"chat.completion","usage":{"total_tokens":66,"total_characters":0,"prompt_tokens":34,"completion_tokens":32},"input_sensitive":false,"output_sensitive":false,"input_sensitive_type":0,"output_sensitive_type":0,"output_sensitive_int":0,"base_resp":{"status_code":0,"status_msg":""}}

```

### MiniMax-M2.5-highspeed
- status: PASS
- note: HTTP 200 with completion content
```json
{"id":"0683108e65b228c390f5aec88b3c10e9","choices":[{"finish_reason":"length","index":0,"message":{"content":"<think>\nThe user is asking me to reply with exactly \"MINIMAX_CURSOR_TEST_OK\" - this is a straightforward request that doesn't raise any safety concerns\n</think>\n","role":"assistant","name":"MiniMax AI","audio_content":""}}],"created":1781783950,"model":"MiniMax-M2.5-highspeed","object":"chat.completion","usage":{"total_tokens":64,"total_characters":0,"prompt_tokens":32,"completion_tokens":32,"completion_tokens_details":{"reasoning_tokens":32}},"input_sensitive":false,"output_sensitive":false,"input_sensitive_type":0,"output_sensitive_type":0,"output_sensitive_int":0,"base_resp":{"status_code":0,"status_msg":""}}

```

### MiniMax-M2.1
- status: PASS
- note: HTTP 200 with completion content
```json
{"id":"06831090895c489e5a52e344ba33cca1","choices":[{"finish_reason":"length","index":0,"message":{"content":"<think>The user is asking me to reply with exactly the text \"MINIMAX_CURSOR_TEST_OK\". This seems to be a test to verify that I can respond</think>\n\n","role":"assistant"}}],"created":1781783952,"model":"MiniMax-M2.1","object":"chat.completion","usage":{"total_tokens":66,"total_characters":0,"prompt_tokens":34,"completion_tokens":32,"prompt_tokens_details":{"cached_tokens":32}},"input_sensitive":false,"output_sensitive":false,"input_sensitive_type":0,"output_sensitive_type":0,"output_sensitive_int":0,"base_resp":{"status_code":0,"status_msg":""}}

```

### MiniMax-M2
- status: PASS
- note: HTTP 200 with completion content
```json
{"id":"0683109198ead52e5f6e852d14d4edf8","choices":[{"finish_reason":"length","index":0,"message":{"content":"<think>\nThe user wants me to reply with exactly: MINIMAX_CURSOR_TEST_OK\n\nThis appears to be a test message to verify that I can respond\n</think>\n","role":"assistant","name":"MiniMax AI","audio_content":""}}],"created":1781783953,"model":"MiniMax-M2","object":"chat.completion","usage":{"total_tokens":64,"total_characters":0,"prompt_tokens":32,"completion_tokens":32,"completion_tokens_details":{"reasoning_tokens":32}},"input_sensitive":false,"output_sensitive":false,"input_sensitive_type":0,"output_sensitive_type":0,"output_sensitive_int":0,"base_resp":{"status_code":0,"status_msg":""}}

```

