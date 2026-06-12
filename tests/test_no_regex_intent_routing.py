from pathlib import Path


INTENT_ROUTING_FILES = [
    Path("yuzik_workflow/policy.py"),
    Path("yuzik_workflow/intent.py"),
    Path("yuzik_workflow/intent_classifier.py"),
    Path("yuzik_workflow/file_policy.py"),
    Path("router_agent/agent.py"),
]

FORBIDDEN_TOKENS = [
    "re.compile",
    "_PATTERN",
    "TTS_REQUESTED_PATTERN",
    "IMAGE_REQUESTED_PATTERN",
    "TIME_RELATED_PATTERN",
    "CREATION_CANCEL_PATTERN",
    "TRANSLATION_REQUEST_PATTERN",
    "ENGLISH_TARGET_PATTERN",
]


def test_intent_routing_modules_do_not_use_regex_routing():
    root = Path(__file__).resolve().parents[1]

    for relative_path in INTENT_ROUTING_FILES:
        source = (root / relative_path).read_text(encoding="utf-8")
        for token in FORBIDDEN_TOKENS:
            assert token not in source, f"{token} found in {relative_path}"
