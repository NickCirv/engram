#!/usr/bin/env bash
# engram v4.0 "Skill Pack" — 30-second demo
# This is the script asciinema records. Hermetic — uses /tmp, cleans up.

set -e

CYAN='\033[36m'
DIM='\033[2m'
RESET='\033[0m'

pause() { sleep "$1"; }

clear
echo -e "${CYAN}# engram v4.0 — bi-temporal mistakes auto-captured from git revert${RESET}"
echo -e "${DIM}# no global install, no commitment, no setup beyond what you see here${RESET}"
pause 2

echo ""
echo -e "${CYAN}# step 1: throwaway repo with a buggy commit + revert${RESET}"
pause 1
rm -rf /tmp/engram-demo-recording
mkdir -p /tmp/engram-demo-recording
cd /tmp/engram-demo-recording
git init -q
git commit --allow-empty -q -m "init"
echo "export const buggy = () => null;" > src.ts
git add -A
git commit -q -m "feat: add buggy helper returning null causing form crashes"
git revert --no-edit HEAD > /dev/null
echo -e "${DIM}  done: 2 commits + 1 revert${RESET}"
pause 2

echo ""
echo -e "${CYAN}# step 2: npx engramx@4.0.0 init . (from the public npm registry)${RESET}"
pause 1
npx --yes engramx@4.0.0 init . 2>&1 | tail -8
pause 3

echo ""
echo -e "${CYAN}# step 3: npx engramx@4.0.0 mistakes${RESET}"
echo -e "${DIM}#         (the git-revert miner auto-captured the bi-temporal pair)${RESET}"
pause 2
npx --yes engramx@4.0.0 mistakes
pause 4

echo ""
echo -e "${CYAN}# that's the rave moment.${RESET}"
echo -e "${DIM}# multiply across your real repo's revert history → engram remembers what your AI agent forgot.${RESET}"
echo -e "${DIM}# install globally: npm i -g engramx@4.0.0${RESET}"
pause 4

# cleanup
cd /tmp && rm -rf /tmp/engram-demo-recording
