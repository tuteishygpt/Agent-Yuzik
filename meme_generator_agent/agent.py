"""
meme_agent.py – ADK LlmAgent that creates Belarusian memes via Memegen
---------------------------------------------------------------------
• Выбірае найлепшы шаблон па лакальным каталогу (RapidFuzz).
• Генеруе беларускія подпісы і вяртае URL гатовага мема.
"""
from __future__ import annotations

from pathlib import Path

from google.adk.agents import LlmAgent

# --- project tools ----------------------------------------------------------
from tools.list_templates import list_memegen_templates
from tools.suggest_templates import suggest_templates
from tools.meme_generator import generate_meme_and_save
from tools.get_template_info import get_template_info

# ---------------------------------------------------------------------------
# Канстанты
# ---------------------------------------------------------------------------

LOCAL_TEMPLATES_PATH: str = (
    Path(__file__).parent / "tools" / "data" / "memegen_templates.json"
).as_posix()



# Вызначэнне LlmAgent
# ---------------------------------------------------------------------------

meme_agent: LlmAgent = LlmAgent(
    name="meme_agent",
    model="gemini-2.5-flash",
    tools=[suggest_templates, get_template_info, generate_meme_and_save, list_memegen_templates],
    description="Агент-мемагенератар (Memegen). Аўтаматычна выбірае шаблон і подпісы.",
    instruction="""
 Мэта
Ствараць вясёлыя, арыгінальныя мемы на аснове запыту.

 Што ў цябе ёсць
• suggest_templates – fuzzy-пошук па лакальным каталогу (id).
• get_template_info – атрымлівае інфармацыю пра шаблон, уключаючы колькасць тэкставых палёў.
• generate_meme_and_save – стварае URL мема (template_id, text_lines, fmt, font).
• list_memegen_templates – паўны спіс (як рэзерв).

 Алгарытм (выконвай па-парадку)

1.  Разбяры запыт: ці зададзены шаблон, у чым сутнасць жарту.
    Калі шаблон не зададзены — скарыстайся `suggest_templates`
    і выберы адзін з трох найлепшых варыянтаў.

2.  Выкарыстоўвай `get_template_info` з ID абранага шаблона, каб даведацца,
    колькі тэкставых палёў (`text_fields_count`) ён патрабуе.

3.  Складзі “plan: …” з адпаведнай колькасцю радкоў;
    не паўтарай даслоўна фразы з запыту, пазбягай банальнасці
    і пазначай, калі радок павінен быць пустым.

4.  Зрабі подпісы:
    • мова – беларуская;
    • ≤ 60 сімвалаў у радку;
    
5.  Сінхронна выклікай `generate_meme_and_save`, перадаўшы `template_id` і спіс радкоў `text_lines`.  
    Выкарыстоўвай font="notosans", fmt="png" (калі гэта не GIF).

6.  Выклікай інструмент `generate_meme_and_save`, каб стварыць і захаваць артэфакт.

7. Калі `generate_meme_and_save` вяртае паведамленне пра поспех, твой фінальны адказ павінен змяшчаць ТОЛЬКІ гэтае паведамленне. Не дадавай нічога ад сябе.
""",
)
