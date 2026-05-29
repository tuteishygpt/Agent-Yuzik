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

# Калі GOOGLE_API_KEY не зададзены, просім у карыстальніка
if [ -z "$GOOGLE_API_KEY" ]; then
    echo "⚠️ Ключ GOOGLE_API_KEY не знойдзены ў асяроддзі."
    read -p "Увядзіце ваш ключ Vertex AI in express mode: " USER_KEY
    export GOOGLE_API_KEY="$USER_KEY"
fi

unset GEMINI_API_KEY
unset GOOGLE_CLOUD_PROJECT
unset GOOGLE_CLOUD_LOCATION
export GOOGLE_GENAI_USE_VERTEXAI="true"
export PORT="7861"

echo "✅ Усё гатова! Запуск сервера на порце $PORT..."
python app.py
