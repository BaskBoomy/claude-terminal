#!/bin/bash
# ttyd entry point: attach to existing tmux session or create new one

SESSION="${TMUX_SESSION:-claude}"

if tmux has-session -t "$SESSION" 2>/dev/null; then
    exec tmux attach -t "$SESSION"
else
    tmux new-session -d -s "$SESSION"
    tmux send-keys -t "$SESSION" "cd ~ && ${CLAUDE_CMD:-claude}" Enter
    exec tmux attach -t "$SESSION"
fi
