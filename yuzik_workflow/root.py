from __future__ import annotations

from google.adk.workflow import DEFAULT_ROUTE, START, Workflow, node

from router_agent.agent import router_agent
from yuzik_workflow.file_policy import file_policy_node
from yuzik_workflow.errors import error_fallback_node
from yuzik_workflow.image_workflow import execute_image_workflow, image_prompt_agent
from yuzik_workflow.context import turn_context_node
from yuzik_workflow.dictionary import dictionary_lookup_node
from yuzik_workflow.intent_classifier import intent_classifier_agent
from yuzik_workflow.policy import intent_policy_node
from yuzik_workflow.post_actions import post_action_node
from yuzik_workflow.postprocess import postprocess_node
from yuzik_workflow.translation import translation_agent
from yuzik_workflow.validation import route_validation_node


def create_yuzik_workflow() -> Workflow:
    turn_context = node(turn_context_node, name="turn_context_node")
    file_policy = node(file_policy_node, name="file_policy_node")
    intent_policy = node(intent_policy_node, name="intent_policy_node")
    fallback = node(error_fallback_node, name="error_fallback_node")
    route_validation = node(route_validation_node, name="route_validation_node")
    post_action = node(post_action_node, name="post_action_node")
    postprocess = node(postprocess_node, name="postprocess_node")
    image_node = node(execute_image_workflow, name="execute_image_workflow")
    image_post_action = node(post_action_node, name="image_post_action_node")
    image_postprocess = node(postprocess_node, name="image_postprocess_node")
    direct_postprocess = node(postprocess_node, name="direct_postprocess_node")
    translation_postprocess = node(
        postprocess_node, name="translation_postprocess_node"
    )
    dictionary_lookup = node(dictionary_lookup_node, name="dictionary_lookup_node")
    dictionary_postprocess = node(postprocess_node, name="dictionary_postprocess_node")
    route_validation_cancel = node(
        route_validation_node, name="route_validation_cancel_node"
    )
    postprocess_cancel = node(postprocess_node, name="postprocess_cancel_node")
    return Workflow(
        name="yuzik_workflow",
        edges=[
            (
                START,
                turn_context,
                file_policy,
                {
                    "file_error": fallback,
                    DEFAULT_ROUTE: intent_classifier_agent,
                },
            ),
            (
                intent_classifier_agent,
                intent_policy,
                {
                    "cancel": route_validation_cancel,
                    "image": image_prompt_agent,
                    "direct": direct_postprocess,
                    "translate": translation_agent,
                    "dictionary": dictionary_lookup,
                    DEFAULT_ROUTE: router_agent,
                },
            ),
            (router_agent, route_validation, post_action, postprocess),
            (image_prompt_agent, image_node, image_post_action, image_postprocess),
            (translation_agent, translation_postprocess),
            (dictionary_lookup, dictionary_postprocess),
            (route_validation_cancel, postprocess_cancel),
        ],
    )
