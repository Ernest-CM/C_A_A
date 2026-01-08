from __future__ import annotations

import json
import logging
import re
import textwrap
from typing import Any, Literal, Optional

import httpx

from app.core.config import settings
from app.services.gemini_client import GeminiClientError, generate_text as gemini_generate_text


logger = logging.getLogger(__name__)


MindmapProvider = Literal["ollama", "openai", "gemini"]


class MindmapGeneratorError(Exception):
    pass


DEFAULT_MAX_SOURCE_CHARS = 8000


def _configured_provider() -> MindmapProvider | None:
    if settings.ollama_url and (getattr(settings, "ollama_mindmap_model", None) or settings.ollama_model):
        return "ollama"
    if settings.openai_api_key:
        return "openai"
    if settings.gemini_api_key:
        return "gemini"
    return None


def _ollama_model() -> str:
    model = getattr(settings, "ollama_mindmap_model", None) or settings.ollama_model
    if not model:
        raise MindmapGeneratorError("Ollama model is not configured")
    return model


def _ollama_endpoint() -> str:
    base = settings.ollama_url.rstrip("/") if settings.ollama_url else ""
    if not base:
        raise MindmapGeneratorError("Ollama URL is not configured")
    return f"{base}/api/generate"


def _max_source_chars() -> int:
    return int(getattr(settings, "mindmap_max_source_chars", DEFAULT_MAX_SOURCE_CHARS))


def _prepare_source(text: str) -> str:
    normalized = " ".join(text.split())
    limit = _max_source_chars()
    if len(normalized) > limit:
        normalized = normalized[:limit]
    return normalized


def _ollama_perf_options() -> dict[str, int]:
    opts: dict[str, int] = {}
    if getattr(settings, "ollama_num_ctx", None) is not None:
        opts["num_ctx"] = int(settings.ollama_num_ctx)
    if getattr(settings, "ollama_num_thread", None) is not None:
        opts["num_thread"] = int(settings.ollama_num_thread)
    if getattr(settings, "ollama_num_batch", None) is not None:
        opts["num_batch"] = int(settings.ollama_num_batch)
    if getattr(settings, "ollama_num_gpu", None) is not None:
        opts["num_gpu"] = int(settings.ollama_num_gpu)
    return opts


def _mindmap_json_schema() -> dict[str, Any]:
    return {
        "type": "object",
        "additionalProperties": False,
        "required": ["title", "root"],
        "properties": {
            "title": {"type": "string"},
            "root": {"$ref": "#/definitions/node"},
        },
        "definitions": {
            "node": {
                "type": "object",
                "additionalProperties": False,
                "required": ["id", "label", "children"],
                "properties": {
                    "id": {"type": "string"},
                    "label": {"type": "string"},
                    "children": {
                        "type": "array",
                        "items": {"$ref": "#/definitions/node"},
                    },
                },
            }
        },
    }


def _build_prompt(source: str, *, max_depth: int, max_nodes: int, title: Optional[str]) -> str:
    title_hint = title.strip() if title else ""
    # Encourage deeper, more detailed maps when allowed.
    depth_target = 4 if max_depth >= 4 else max_depth
    depth_guidance = (
        f"Aim for at least {depth_target} levels when the notes support it: "
        "root → main branch → sub-branch → detail nodes."
    )
    return textwrap.dedent(
        f"""\
        Task: Create a STUDY mind map from the provided notes.

        Requirements:
        - Output ONLY valid JSON (no markdown, no extra text).
        - Keep labels short (2-6 words), clear, and exam-oriented.
        - Total nodes <= {max_nodes}.
        - Depth <= {max_depth} (root counts as depth 1).
        - {depth_guidance}
        - For EACH main branch: add 2-5 sub-branches.
        - For EACH sub-branch: add 1-3 detail nodes (definitions, key points, examples, steps) from the notes.
        - Prefer 5-8 main branches, then sub-branches.
        - Avoid filler like "introduction" or "overview" unless meaningful.
        - If you include formulas, keep them short.
        - Do NOT stop early if you still have node budget and the notes contain details.
        - Do not invent facts not supported by the notes.

        Output format:
        - JSON must match this schema exactly:
          {{
            "title": string,
            "root": {{"id": string, "label": string, "children": [node...]}}
          }}

        Title hint (optional): {title_hint}

        NOTES START
        {source}
        NOTES END
        """
    ).strip()


def _strip_code_fences(s: str) -> str:
    s = (s or "").strip()
    m = re.search(r"```(?:json)?\s*(.*?)\s*```", s, flags=re.IGNORECASE | re.DOTALL)
    if m:
        return (m.group(1) or "").strip()
    s = re.sub(r"```(?:json)?", "", s, flags=re.IGNORECASE)
    return s.replace("```", "").strip()


def _first_balanced_json_object(s: str) -> str | None:
    in_string = False
    escape = False
    depth = 0
    start: int | None = None

    for i, ch in enumerate(s):
        if in_string:
            if escape:
                escape = False
                continue
            if ch == "\\":
                escape = True
                continue
            if ch == '"':
                in_string = False
            continue

        if ch == '"':
            in_string = True
            continue

        if ch == "{":
            if depth == 0:
                start = i
            depth += 1
            continue

        if ch == "}" and depth > 0:
            depth -= 1
            if depth == 0 and start is not None:
                return s[start : i + 1]

    return None


def _extract_json(text: str) -> Any:
    raw = _strip_code_fences(text)
    try:
        return json.loads(raw)
    except Exception:
        pass

    candidate = _first_balanced_json_object(raw)
    if candidate:
        try:
            return json.loads(candidate)
        except Exception:
            pass

    raise MindmapGeneratorError("Model did not return valid JSON")


def _sanitize_tree(root: dict[str, Any], *, max_depth: int, max_nodes: int) -> dict[str, Any]:
    # Normalize minimal node shape and then prune for depth/nodes.
    next_id = 1

    def normalize(node: Any) -> dict[str, Any]:
        nonlocal next_id
        if not isinstance(node, dict):
            node = {}
        node_id = str(node.get("id") or f"n{next_id}")
        if "id" not in node or not str(node.get("id") or "").strip():
            next_id += 1
        label = str(node.get("label") or "").strip()
        if not label:
            label = "Untitled"
        children_raw = node.get("children")
        children_list = children_raw if isinstance(children_raw, list) else []
        return {
            "id": node_id,
            "label": label,
            "children": [normalize(c) for c in children_list],
        }

    normalized = normalize(root)
    normalized["id"] = "root"

    # Prune by depth
    def prune_depth(node: dict[str, Any], depth: int) -> None:
        if depth >= max_depth:
            node["children"] = []
            return
        for c in node.get("children", []):
            prune_depth(c, depth + 1)

    prune_depth(normalized, 1)

    # Prune by node count (BFS order)
    count = 0
    queue: list[dict[str, Any]] = [normalized]
    while queue:
        cur = queue.pop(0)
        count += 1
        if count >= max_nodes:
            cur["children"] = []
            continue
        children = cur.get("children") or []
        remaining = max_nodes - count
        if len(children) > remaining:
            children = children[:remaining]
            cur["children"] = children
        queue.extend(children)

    return normalized


def _tree_stats(root: dict[str, Any]) -> tuple[int, int]:
    # Returns (max_depth, node_count)
    max_d = 0
    count = 0
    queue: list[tuple[dict[str, Any], int]] = [(root, 1)]
    while queue:
        node, d = queue.pop(0)
        count += 1
        if d > max_d:
            max_d = d
        for c in (node.get("children") or []):
            if isinstance(c, dict):
                queue.append((c, d + 1))
    return max_d, count


def _build_refine_prompt(
    source: str,
    *,
    existing: dict[str, Any],
    max_depth: int,
    max_nodes: int,
    title: Optional[str],
) -> str:
    title_hint = title.strip() if title else ""
    # Be explicit about adding depth and detail.
    target_depth = min(max_depth, 5)
    return textwrap.dedent(
        f"""\
        Task: Refine and EXPAND an existing mind map using the provided notes.

        Goals:
        - Increase detail depth (up to depth {max_depth}) and richness (up to {max_nodes} total nodes).
        - Ensure the final map reaches at least depth {target_depth} if node budget allows.
        - Keep labels short (2-6 words).

        Hard rules:
        - Output ONLY valid JSON (no markdown, no extra text).
        - Do NOT remove or rename existing nodes.
        - Do NOT change existing ids.
        - You may ONLY add new children under existing nodes.
        - Do NOT invent new facts; if the notes are sparse, add clarifying subpoints that rephrase the existing idea.

        Guidance:
        - Prefer to expand nodes that currently have empty children.
        - Add children under leaf nodes until depth {target_depth} is achieved or node budget is exhausted.
        - For leaf nodes: add 2-4 children that explain/define/examples/steps.
        - Keep each new child grounded in the notes; if the notes are abstract, rephrase into practical subpoints.

        Title hint (optional): {title_hint}

        EXISTING MIND MAP JSON
        {json.dumps(existing, ensure_ascii=False)}

        NOTES START
        {source}
        NOTES END
        """
    ).strip()


async def _refine_once(
    *, source: str, existing_title: str, existing_root: dict[str, Any], max_depth: int, max_nodes: int, num_predict: int
) -> dict[str, Any] | None:
    refine_prompt = _build_refine_prompt(
        source,
        existing={"title": existing_title, "root": existing_root},
        max_depth=max_depth,
        max_nodes=max_nodes,
        title=existing_title,
    )
    refine_raw = await _generate_with_ollama(refine_prompt, num_predict=num_predict)
    refined_obj = _extract_json(refine_raw)
    if isinstance(refined_obj, dict) and isinstance(refined_obj.get("root"), dict):
        return refined_obj
    return None


async def _generate_with_ollama(prompt: str, *, num_predict: int) -> str:
    payload = {
        "model": _ollama_model(),
        "prompt": prompt,
        "system": "You are a strict JSON generator. Output only valid JSON.",
        "format": _mindmap_json_schema(),
        "stream": False,
        "keep_alive": getattr(settings, "ollama_keep_alive", "30m"),
        "options": {"temperature": 0.2, "num_predict": int(num_predict), **_ollama_perf_options()},
    }

    timeout = httpx.Timeout(300.0, connect=10.0)
    async with httpx.AsyncClient(timeout=timeout) as client:
        try:
            res = await client.post(_ollama_endpoint(), json=payload)
            res.raise_for_status()
        except httpx.HTTPStatusError as exc:
            raise MindmapGeneratorError(f"Ollama request failed: {exc.response.text}") from exc
        except httpx.TimeoutException as exc:
            raise MindmapGeneratorError("Ollama request timed out. Try smaller max_nodes.") from exc
        except httpx.RequestError as exc:
            raise MindmapGeneratorError(f"Ollama request error: {exc}") from exc

    data = res.json()
    if data.get("error"):
        raise MindmapGeneratorError(f"Ollama error: {data.get('error')}")

    out = (data.get("response") or "").strip()
    if not out:
        raise MindmapGeneratorError("Ollama response was empty")
    return out


async def _generate_with_gemini(prompt: str, *, max_output_tokens: int) -> str:
    try:
        return await gemini_generate_text(
            prompt,
            system_prompt="You are a strict JSON generator. Output only valid JSON.",
            temperature=0.2,
            max_output_tokens=int(max_output_tokens),
            timeout_seconds=240.0,
        )
    except GeminiClientError as exc:
        raise MindmapGeneratorError(str(exc)) from exc


async def generate_mindmap_with_provider(
    text: str,
    *,
    max_depth: int = 4,
    max_nodes: int = 40,
    title: Optional[str] = None,
    provider: MindmapProvider | str | None = None,
) -> dict[str, Any]:
    provider = (provider or "").strip().lower() or None
    if provider is None:
        provider = _configured_provider()
    if not provider:
        raise MindmapGeneratorError("No mindmap provider configured")

    if max_depth < 2 or max_depth > 8:
        raise MindmapGeneratorError("max_depth must be between 2 and 8")
    if max_nodes < 10 or max_nodes > 200:
        raise MindmapGeneratorError("max_nodes must be between 10 and 200")

    source = _prepare_source(text)
    if not source:
        raise MindmapGeneratorError("No extracted text available to generate a mind map")

    prompt = _build_prompt(source, max_depth=max_depth, max_nodes=max_nodes, title=title)

    # Mindmaps are medium-sized JSON; keep token budget bounded for latency.
    num_predict = min(4096, max(900, int(45 * max_nodes)))

    if provider == "ollama":
        raw = await _generate_with_ollama(prompt, num_predict=num_predict)
    elif provider == "gemini":
        raw = await _generate_with_gemini(prompt, max_output_tokens=num_predict)
    elif provider == "openai":
        raise MindmapGeneratorError("OpenAI mindmap provider not implemented")
    else:
        raise MindmapGeneratorError(f"Unsupported provider: {provider}")

    obj = _extract_json(raw)
    if not isinstance(obj, dict):
        raise MindmapGeneratorError("Mindmap JSON must be an object")

    root = obj.get("root")
    if not isinstance(root, dict):
        raise MindmapGeneratorError("Mindmap JSON must include a root object")

    clean_root = _sanitize_tree(root, max_depth=max_depth, max_nodes=max_nodes)
    title_out = str(obj.get("title") or title or "Mind Map").strip() or "Mind Map"

    # Optional refinement pass to deepen shallow trees.
    observed_depth, observed_nodes = _tree_stats(clean_root)
    target_depth = min(max_depth, 4)
    if observed_depth < target_depth and observed_nodes < max_nodes:
        try:
            refine_prompt = _build_refine_prompt(
                source,
                existing={"title": title_out, "root": clean_root},
                max_depth=max_depth,
                max_nodes=max_nodes,
                title=title_out,
            )
            if provider == "ollama":
                refine_raw = await _generate_with_ollama(refine_prompt, num_predict=min(4096, num_predict + 900))
            else:
                refine_raw = await _generate_with_gemini(refine_prompt, max_output_tokens=min(4096, num_predict + 900))

            refined_obj = _extract_json(refine_raw)
            if isinstance(refined_obj, dict) and isinstance(refined_obj.get("root"), dict):
                clean_root = _sanitize_tree(refined_obj["root"], max_depth=max_depth, max_nodes=max_nodes)
        except Exception as exc:
            logger.info("Mindmap refinement skipped/failed: %s", exc)

    return {"provider": provider, "mindmap": {"title": title_out, "root": clean_root}}

