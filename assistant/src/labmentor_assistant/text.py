"""Tokenizing and sentence splitting shared by retrieval, guardrails and the offline model."""

from __future__ import annotations

import re

STOPWORDS = frozenset(
    """
    a about after again all also am an and any are as at be because been before being but by can could did do
    does doing done for from get got had has have having how i if in into is it its just me my no not of on
    once only or other our out over own please same should so some such than that the their them then there
    these they this those through to too under until up very was we were what when where which while who why
    will with would you your
    """.split()  # noqa: SIM905
)

_WORD = re.compile(r"[a-z0-9]+")
_SENTENCE_END = re.compile(r"(?<=[.!?])\s+(?=[A-Z`*\"(])")
_PARAGRAPH = re.compile(r"\n\s*\n")


def words(text: str) -> list[str]:
    return _WORD.findall(text.lower())


def stem(word: str) -> str:
    """A deliberately small stemmer: enough to match create/creates/created/creating."""
    if len(word) <= 3 or word.isdigit():
        return word
    for suffix in ("ing", "ed", "es", "s"):
        if word.endswith(suffix) and len(word) - len(suffix) >= 3 and not (suffix == "s" and word.endswith("ss")):
            word = word[: -len(suffix)]
            break
    if word.endswith("e") and len(word) > 3:
        word = word[:-1]
    return word


def terms(text: str) -> list[str]:
    """Content terms: lower-cased, stemmed, without stopwords or single characters."""
    return [stem(w) for w in words(text) if w not in STOPWORDS and len(w) > 1]


def paragraphs(text: str) -> list[str]:
    return [" ".join(p.split()) for p in _PARAGRAPH.split(text.strip()) if p.strip()]


def sentences(text: str) -> list[str]:
    out: list[str] = []
    for paragraph in paragraphs(text):
        out.extend(s.strip() for s in _SENTENCE_END.split(paragraph) if s.strip())
    return out


def word_count(text: str) -> int:
    return len(text.split())
