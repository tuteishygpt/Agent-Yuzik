import importlib
import os
import sys


sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))


def test_adk_function_tools_build_declarations_without_missing_return_annotations():
    tool_specs = [
        ("tools.weather_tool", "weather_tool"),
        ("tools.verbum_tool", "verbum_tool"),
        ("tools.gemini_image_generator", "generate_image_tool"),
        ("tools.minsk_datetime_tool", "minsk_datetime_tool"),
        ("tools.suggest_templates", "suggest_templates"),
        ("tools.get_template_info", "get_template_info"),
        ("tools.meme_generator", "generate_meme_and_save"),
        ("tools.list_templates", "list_memegen_templates"),
    ]

    for module_name, tool_name in tool_specs:
        module = importlib.import_module(module_name)
        tool = getattr(module, tool_name)
        if not hasattr(tool, "_get_declaration"):
            from google.adk.tools import FunctionTool

            tool = FunctionTool(tool)

        declaration = tool._get_declaration()

        assert declaration.name
