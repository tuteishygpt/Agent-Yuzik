from dataclasses import asdict

from yuzik_workflow.state import ExecutionResult, RoutePlan, YuzikWorkflowState


def test_workflow_state_defaults_round_trip():
    state = YuzikWorkflowState(
        user_id="u1",
        channel="web",
        conversation_id="c1",
        session_id="s1",
        text="Прывітанне",
    )

    data = asdict(state)
    restored = YuzikWorkflowState(**data)

    assert restored.language == "be"
    assert restored.file_ok is True
    assert restored.tts_requested is False
    assert restored.artifact_delta == {}


def test_route_plan_and_execution_result_have_independent_collections():
    first = RoutePlan(primary_route="chat")
    second = RoutePlan(primary_route="search")
    first.args["q"] = "Купала"
    first.post_actions.append("tts")

    result = ExecutionResult()
    result.parts.append("part")
    result.artifact_delta["a.wav"] = 0

    assert second.args == {}
    assert second.post_actions == []
    assert result.text is None
    assert result.error is None
