from router_agent.agent import router_agent


def test_router_agent_route_first_tools_removed():
    tool_names = {getattr(tool, "name", "") for tool in router_agent.tools}

    assert "synthesize_speech" not in tool_names
    assert "generate_image" not in tool_names
    assert {"search_agent", "meme_agent", "get_weather", "lookup_verbum"} <= tool_names


def test_router_instruction_does_not_call_removed_route_first_tools():
    assert "`synthesize_speech`" not in router_agent.instruction
    assert "`generate_image`" not in router_agent.instruction
