#!/bin/bash
# -------------------------------------------------------------------
# Універсальны скрыпт для ўсталёўкі і запуску Agent Yuzik (Ubuntu/Debian)
# -------------------------------------------------------------------

echo "🚀 Падрыхтоўка і запуск Agent Yuzik..."
echo "-------------------------------------------------------------------"

# 1. Абнаўленне і ўсталёўка базавых пакетаў
# (ffmpeg патрабуецца для апрацоўкі аўдыя/відэа)
echo "[1/6] Усталёўка сістэмных пакетаў..."
sudo apt-get update
sudo apt-get install -y ffmpeg git python3-pip python3-venv npm

# 2. Кланаванне рэпазіторыя
echo "[2/6] Кланаванне і абнаўленне рэпазіторыя..."
if [ ! -d "Agent-Yuzik" ]; then
    git clone https://github.com/tuteishygpt/Agent-Yuzik.git
fi
cd Agent-Yuzik
git pull origin main

# 3. Наладка віртуальнага асяроддзя (каб не ламаць сістэмны Python)
echo "[3/6] Стварэнне віртуальнага Python-асяроддзя..."
if [ ! -d ".venv" ]; then
    python3 -m venv .venv
fi
source .venv/bin/activate

# 4. Усталёўка Python-залежнасцяў
echo "[4/6] Усталёўка Python-залежнасцяў..."
pip install -r requirements.txt

# 5. Зборка вэб-інтэрфейсу (фронтэнда)
echo "[5/6] Зборка вэб-інтэрфейсу..."
cd frontend
npm install
npm run build
cd ..

# 6. Запыт ключоў і запуск
echo "[6/6] Запуск..."
echo "-------------------------------------------------------------------"

# Калі GEMINI_API_KEY не зададзены, просім у карыстальніка
if [ -z "$GEMINI_API_KEY" ]; then
    echo "⚠️ Ключ GEMINI_API_KEY не знойдзены ў асяроддзі."
    read -p "Увядзіце ваш ключ Google Gemini: " USER_KEY
    export GEMINI_API_KEY="$USER_KEY"
fi

export GOOGLE_API_KEY=$GEMINI_API_KEY
export PORT="7861"

echo "✅ Усё гатова! Запуск сервера на порце $PORT..."
python app.py
