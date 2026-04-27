"""AURA's Terminal-Bench agent package.

The public surface is just :class:`AuraAgent`. We resolve it lazily via
``__getattr__`` so that this package can be imported (e.g. by unittest's
path-based test loader walking through ``aura_agent`` on its way to the
sibling test file) without immediately pulling in ``terminal_bench``.

Terminal-Bench's actual entry point — ``aura_agent.aura_agent:AuraAgent`` —
imports the inner module directly and is unaffected by the indirection.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

__all__ = ["AuraAgent"]

if TYPE_CHECKING:  # pragma: no cover - import-time hint only
    from .aura_agent import AuraAgent as AuraAgent


def __getattr__(name: str):
    if name == "AuraAgent":
        from .aura_agent import AuraAgent as _AuraAgent

        return _AuraAgent
    raise AttributeError(f"module 'aura_agent' has no attribute {name!r}")
