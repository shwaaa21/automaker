#!/bin/sh
set -e

# Fix permissions on Claude CLI config directory if it exists
# This handles the case where a volume is mounted and owned by root
if [ -d "/home/automaker/.claude" ]; then
    chown -R automaker:automaker /home/automaker/.claude
    chmod -R 755 /home/automaker/.claude
fi

# Ensure the directory exists with correct permissions if volume is empty
if [ ! -d "/home/automaker/.claude" ]; then
    mkdir -p /home/automaker/.claude
    chown automaker:automaker /home/automaker/.claude
    chmod 755 /home/automaker/.claude
fi

# Switch to automaker user and execute the command
exec su-exec automaker "$@"
