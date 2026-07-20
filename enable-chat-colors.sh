#!/usr/bin/env bash
# Back-compat wrapper — prefer: ./cursor-chat-colors on
exec "$(cd "$(dirname "$0")" && pwd)/cursor-chat-colors" "${1:-on}"
