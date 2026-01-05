"""
get_template_info.py – A tool for retrieving information about a meme template.
"""

import json
from pathlib import Path
from typing import Dict, Any, Optional

# Path to the local template catalog
LOCAL_TEMPLATES_PATH = (
    Path(__file__).parent / "data" / "memegen_templates.json"
).resolve()


def get_template_info(template_id: str) -> Optional[Dict[str, Any]]:
    """Retrieves information about a specific meme template by its ID.

    Args:
        template_id: The ID of the meme template (e.g., "successkid").

    Returns:
        A dictionary with template information (id, name, example, etc.)
        or None if the template is not found.
    """
    try:
        with open(LOCAL_TEMPLATES_PATH, "r", encoding="utf-8") as f:
            templates = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return None

    for template in templates:
        if template.get("id") == template_id:
            # Calculate the number of text fields based on the example
            if "example" in template and "text" in template["example"]:
                template["text_fields_count"] = len(template["example"]["text"])
            else:
                template["text_fields_count"] = 0  # Default if no example text
            return template

    return None
