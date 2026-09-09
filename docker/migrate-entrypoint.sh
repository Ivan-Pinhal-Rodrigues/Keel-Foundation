#!/bin/sh
set -e
pnpm exec prisma migrate deploy
echo "migrate: applied"
