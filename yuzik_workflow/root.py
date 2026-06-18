from __future__ import annotations

from google.adk.workflow import DEFAULT_ROUTE, START, Workflow, node

from google_search_agent.agent import search_agent
from router_agent.agent import router_agent
from yuzik_workflow.file_policy import file_policy_node
from yuzik_workflow.errors import error_fallback_node
from yuzik_workflow.image_workflow import execute_image_workflow, image_prompt_agent
from yuzik_workflow.context import turn_context_node
from yuzik_workflow.context_pack import conversation_context_node
from yuzik_workflow.dictionary import dictionary_lookup_node
from yuzik_workflow.memory_update import memory_update_node
from yuzik_workflow.post_actions import post_action_node
from yuzik_workflow.postprocess import postprocess_node
from yuzik_workflow.route_executor import (
    route_executor_node,
    search_query_node,
    weather_lookup_node,
)
from yuzik_workflow.routing_planner import routing_planner_agent
from yuzik_workflow.translation import translation_agent
from yuzik_workflow.validation import route_validation_node


def create_yuzik_workflow() -> Workflow:
    turn_context = node(turn_context_node, name="turn_context_node")
    file_policy = node(file_policy_node, name="file_policy_node")
    conversation_context = node(
        conversation_context_node, name="conversation_context_node"
    )
    route_executor = node(route_executor_node, name="route_executor_node")
    fallback = node(error_fallback_node, name="error_fallback_node")
    route_validation = node(route_validation_node, name="route_validation_node")
    post_action = node(post_action_node, name="post_action_node")
    memory_update = node(memory_update_node, name="memory_update_node")
    postprocess = node(postprocess_node, name="postprocess_node")
    image_node = node(execute_image_workflow, name="execute_image_workflow")
    image_post_action = node(post_action_node, name="image_post_action_node")
    image_memory_update = node(memory_update_node, name="image_memory_update_node")
    image_postprocess = node(postprocess_node, name="image_postprocess_node")
    direct_memory_update = node(memory_update_node, name="direct_memory_update_node")
    direct_postprocess = node(postprocess_node, name="direct_postprocess_node")
    translation_memory_update = node(
        memory_update_node, name="translation_memory_update_node"
    )
    translation_postprocess = node(
        postprocess_node, name="translation_postprocess_node"
    )
    dictionary_lookup = node(dictionary_lookup_node, name="dictionary_lookup_node")
    dictionary_memory_update = node(
        memory_update_node, name="dictionary_memory_update_node"
    )
    dictionary_postprocess = node(postprocess_node, name="dictionary_postprocess_node")
    weather_lookup = node(weather_lookup_node, name="weather_lookup_node")
    weather_memory_update = node(memory_update_node, name="weather_memory_update_node")
    weather_postprocess = node(postprocess_node, name="weather_postprocess_node")
    search_query = node(search_query_node, name="search_query_node")
    search_memory_update = node(memory_update_node, name="search_memory_update_node")
    search_postprocess = node(postprocess_node, name="search_postprocess_node")
    cancel_memory_update = node(memory_update_node, name="cancel_memory_update_node")
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
                    DEFAULT_ROUTE: conversation_context,
                },
            ),
            (
                conversation_context,
                routing_planner_agent,
                route_executor,
                {
                    "cancel": cancel_memory_update,
                    "image": image_prompt_agent,
                    "direct": direct_memory_update,
                    "translate": translation_agent,
                    "dictionary": dictionary_lookup,
                    "weather": weather_lookup,
                    "search": search_query,
                    DEFAULT_ROUTE: router_agent,
                },
            ),
            (router_agent, route_validation, post_action, memory_update, postprocess),
            (
                image_prompt_agent,
                image_node,
                image_post_action,
                image_memory_update,
                image_postprocess,
            ),
            (translation_agent, translation_memory_update, translation_postprocess),
            (dictionary_lookup, dictionary_memory_update, dictionary_postprocess),
            (weather_lookup, weather_memory_update, weather_postprocess),
            (search_query, search_agent, search_memory_update, search_postprocess),
            (direct_memory_update, direct_postprocess),
            (cancel_memory_update, postprocess_cancel),
        ],
    )
