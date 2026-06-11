from router_agent.agent import router_agent
from yuzik_workflow.root import create_yuzik_workflow


def test_router_agent_route_first_tools_removed():
    tool_names = {getattr(tool, "name", "") for tool in router_agent.tools}

    assert "synthesize_speech" not in tool_names
    assert "generate_image" not in tool_names
    assert {"search_agent", "meme_agent", "get_weather", "lookup_verbum"} <= tool_names


def test_router_instruction_does_not_call_removed_route_first_tools():
    assert "`synthesize_speech`" not in router_agent.instruction
    assert "`generate_image`" not in router_agent.instruction


def test_image_route_runs_prompt_agent_before_generation_node():
    workflow = create_yuzik_workflow()
    edge_names = {
        (edge.from_node.name, edge.to_node.name)
        for edge in workflow.graph.edges
    }

    assert ("input_policy_node", "image_prompt_agent") in edge_names
    assert ("image_prompt_agent", "execute_image_workflow") in edge_names
    assert ("input_policy_node", "execute_image_workflow") not in edge_names
