# AIBridge Skill

Connect a coding agent (Grok Build, Claude Code, Codex, etc.) to the AIBridge web chat at **https://aibridge.tanstudio.me**.

## What the user provides

1. **API key** from Account page (`ab_...`)
2. **Project name** (or slug / id) created on the website
3. Optional custom project display name if not provided

## Agent setup (do this automatically)

1. Download the client binary from GitHub Releases:
   - `https://github.com/YizeHe/aibridge/releases/latest`
   - Or build: `cd client && go build -o aibridge .`
2. Store config (example):

```bash
export AIBRIDGE_SERVER=https://aibridge.tanstudio.me
export AIBRIDGE_API_KEY=ab_xxxxxxxx
export AIBRIDGE_PROJECT=my-project
```

3. Poll loop (every 15–60s, also after finishing each task):

```bash
./aibridge -key "$AIBRIDGE_API_KEY" -project "$AIBRIDGE_PROJECT" -server "$AIBRIDGE_SERVER" -once
```

4. When pending user messages appear, process them and reply:

```bash
# progress update (does not ack user messages — keep streaming status)
./aibridge -key "$KEY" -project "$PROJECT" -reply "### Working on it
- step 1 done
- step 2 in progress" -progress -once

# final reply (acks pending user messages)
./aibridge -key "$KEY" -project "$PROJECT" -reply "Done. Full answer..." -once
```

## HTTP API (if not using the binary)

```http
GET /api/agent/pending?project=NAME
X-API-Key: ab_xxx

POST /api/agent/reply
X-API-Key: ab_xxx
Content-Type: application/json

{"project":"NAME","text":"markdown..."}
```

## Rules

- Prefer **Markdown** in replies (web renders it).
- Send **progress** messages while working (`progress: true`).
- Never print the full API key in public logs.

## Local bridge compatibility

The older single-user local bridge (`:5565` on new-api-js) is separate. AIBridge is the multi-user cloud product.
