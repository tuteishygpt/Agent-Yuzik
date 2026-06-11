from __future__ import annotations

from google.adk.workflow import DEFAULT_ROUTE, START, Workflow, node

from router_agent.agent import router_agent
from yuzik_workflow.errors import error_fallback_node
from yuzik_workflow.image_workflow import execute_image_workflow, image_prompt_agent
from yuzik_workflow.policy import input_policy_node
from yuzik_workflow.post_actions import post_action_node
from yuzik_workflow.postprocess import postprocess_node
from yuzik_workflow.validation import route_validation_node


def create_yuzik_workflow() -> Workflow:
    input_policy = node(input_policy_node, name="input_policy_node")
    fallback = node(error_fallback_node, name="error_fallback_node")
    route_validation = node(route_validation_node, name="route_validation_node")
    post_action = node(post_action_node, name="post_action_node")
    postprocess = node(postprocess_node, name="postprocess_node")
    image_node = node(execute_image_workflow, name="execute_image_workflow")
    image_post_action = node(post_action_node, name="image_post_action_node")
    image_postprocess = node(postprocess_node, name="image_postprocess_node")
    route_validation_cancel = node(
        route_validation_node, name="route_validation_cancel_node"
    )
    postprocess_cancel = node(postprocess_node, name="postprocess_cancel_node")
    return Workflow(
        name="yuzik_workflow",
        edges=[
            (
                START,
                input_policy,
                {
                    "file_error": fallback,
                    "cancel": route_validation_cancel,
                    "image": image_prompt_agent,
                    DEFAULT_ROUTE: router_agent,
                },
            ),
            (router_agent, route_validation, post_action, postprocess),
            (image_prompt_agent, image_node, image_post_action, image_postprocess),
            (route_validation_cancel, postprocess_cancel),
        ],
    )
