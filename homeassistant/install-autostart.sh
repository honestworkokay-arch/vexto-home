#!/bin/sh
set -eu
cd "$(dirname "$0")"
cp com.smarthub.homeassistant.plist "$HOME/Library/LaunchAgents/com.smarthub.homeassistant.plist"
launchctl bootout "gui/$(id -u)/com.smarthub.homeassistant" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/com.smarthub.homeassistant.plist"
echo "Автозапуск Home Assistant записано."
echo "Черга ДТЕК змінюється змінною DTEK_GROUP у /Users/macbookpro/Projects/vexto-home/.env, зараз 3.2."
echo "Telegram не обов'язковий. Якщо з'явиться бот, додайте TELEGRAM_BOT_TOKEN і TELEGRAM_CHAT_ID у homeassistant/.env."
