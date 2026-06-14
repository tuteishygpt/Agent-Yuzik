from google.adk.tools import agent_tool

from router_agent.agent import router_agent


def _tool_names():
    return {getattr(tool, "name", "") for tool in router_agent.tools}


def test_router_exposes_all_backend_text_tools():
    assert _tool_names() == {
        "search_agent",
        "meme_agent",
        "get_minsk_datetime",
        "get_weather",
        "lookup_dictionary",
    }


def test_router_keeps_route_first_media_tools_out_of_llm_tool_list():
    assert "synthesize_speech" not in _tool_names()
    assert "generate_image" not in _tool_names()


def test_router_wraps_search_and_meme_as_agent_tools():
    agent_tool_names = {
        tool.name
        for tool in router_agent.tools
        if isinstance(tool, agent_tool.AgentTool)
    }

    assert agent_tool_names == {"search_agent", "meme_agent"}


def test_router_function_tools_have_vertex_compatible_declarations():
    function_tools = [
        tool
        for tool in router_agent.tools
        if not isinstance(tool, agent_tool.AgentTool)
    ]

    assert {tool.name for tool in function_tools} == {
        "get_minsk_datetime",
        "get_weather",
        "lookup_dictionary",
    }
    for tool in function_tools:
        declaration = tool._get_declaration()
        assert declaration.name == tool.name
        assert declaration.parameters is not None
