"""Retrieval over one lab's guide and troubleshooting notes.

Two rankers run side by side and are merged with reciprocal rank fusion:

* BM25 over stemmed terms, which is good at exact names such as ``rg-aca-lab`` or ``33504``.
* Cosine similarity of hashed word and character n-gram vectors, which tolerates typos and word forms.

Both are deterministic and need no model or network, so tests and evals give the same answer on every run.
A lab has at most a few hundred passages, so the index is built in memory per request and cached by content.
"""

from __future__ import annotations

import hashlib
import math
from collections import Counter, OrderedDict
from dataclasses import dataclass
from typing import Literal

from .models import Lab
from .text import paragraphs, terms, word_count

CHUNK_WORDS = 70
MIN_TAIL_WORDS = 30
VECTOR_DIMENSIONS = 1024
RRF_K = 60


@dataclass(frozen=True)
class Passage:
    id: str
    kind: Literal["step", "faq"]
    step: int | None
    title: str
    text: str
    graded: bool = False


@dataclass(frozen=True)
class Hit:
    passage: Passage
    score: float
    relevance: float


def chunk_lab(lab: Lab) -> list[Passage]:
    """Split each step into passages of roughly CHUNK_WORDS words on paragraph boundaries.

    The first passage of step 3 is ``step-3``, the next ``step-3-2``. FAQ entries become ``faq-1``, ``faq-2``.
    Hints and solutions are never indexed; they are only reachable through the hint tool and its policy.
    """
    passages: list[Passage] = []
    for step in lab.steps:
        title = f"Step {step.position}: {step.title}"
        groups: list[list[str]] = [[]]
        for paragraph in paragraphs(step.body):
            if groups[-1] and sum(word_count(p) for p in groups[-1]) >= CHUNK_WORDS:
                groups.append([])
            groups[-1].append(paragraph)
        # A short tail reads better as part of the passage before it than as a passage of its own.
        if len(groups) > 1 and sum(word_count(p) for p in groups[-1]) < MIN_TAIL_WORDS:
            groups[-2].extend(groups.pop())
        for i, group in enumerate(g for g in groups if g):
            passage_id = f"step-{step.position}" if i == 0 else f"step-{step.position}-{i + 1}"
            passages.append(Passage(passage_id, "step", step.position, title, "\n\n".join(group), step.graded))
    for i, entry in enumerate(lab.faq, start=1):
        passages.append(Passage(f"faq-{i}", "faq", None, entry.question, " ".join(entry.answer.split())))
    return passages


def _hash(feature: str) -> tuple[int, float]:
    digest = hashlib.blake2b(feature.encode(), digest_size=8).digest()
    value = int.from_bytes(digest, "big")
    return value % VECTOR_DIMENSIONS, 1.0 if (value >> 63) & 1 else -1.0


def embed(text: str) -> dict[int, float]:
    """Signed feature hashing of terms, term bigrams and character trigrams, L2-normalised."""
    tokens = terms(text)
    features: dict[str, float] = {}
    for i, token in enumerate(tokens):
        features[f"w:{token}"] = features.get(f"w:{token}", 0.0) + 2
        if i + 1 < len(tokens):
            bigram = f"b:{token}_{tokens[i + 1]}"
            features[bigram] = features.get(bigram, 0.0) + 1
        padded = f"#{token}#"
        for j in range(len(padded) - 2):
            trigram = f"c:{padded[j : j + 3]}"
            features[trigram] = features.get(trigram, 0.0) + 0.5
    vector: dict[int, float] = {}
    for feature, count in features.items():
        index, sign = _hash(feature)
        weight = 1 + math.log(count) if count >= 1 else count
        vector[index] = vector.get(index, 0.0) + sign * weight
    norm = math.sqrt(sum(v * v for v in vector.values()))
    return {k: v / norm for k, v in vector.items()} if norm else {}


def cosine(a: dict[int, float], b: dict[int, float]) -> float:
    if len(a) > len(b):
        a, b = b, a
    return max(0.0, sum(value * b.get(key, 0.0) for key, value in a.items()))


class LabIndex:
    def __init__(self, passages: list[Passage]) -> None:
        self.passages = passages
        self.by_id = {p.id: p for p in passages}
        self._terms = [terms(f"{p.title} {p.text}") for p in passages]
        self._term_counts = [Counter(t) for t in self._terms]
        self._term_sets = [set(t) for t in self._terms]
        self._vectors = [embed(f"{p.title} {p.text}") for p in passages]
        self._avg_length = sum(len(t) for t in self._terms) / max(1, len(self._terms))
        document_frequency: Counter[str] = Counter()
        for term_set in self._term_sets:
            document_frequency.update(term_set)
        n = len(passages)
        self._idf = {term: math.log(1 + (n - df + 0.5) / (df + 0.5)) for term, df in document_frequency.items()}
        self._unseen_idf = math.log(1 + (n + 0.5) / 0.5)

    @classmethod
    def for_lab(cls, lab: Lab) -> LabIndex:
        return cls(chunk_lab(lab))

    def _bm25(self, query_terms: list[str], i: int, k1: float = 1.2, b: float = 0.75) -> float:
        counts = self._term_counts[i]
        length = len(self._terms[i])
        score = 0.0
        for term in query_terms:
            frequency = counts.get(term, 0)
            if frequency:
                idf = self._idf[term]
                score += idf * frequency * (k1 + 1) / (frequency + k1 * (1 - b + b * length / self._avg_length))
        return score

    def _coverage(self, query_terms: set[str], i: int) -> float:
        """Share of the query's information (idf-weighted) that the passage contains."""
        if not query_terms:
            return 0.0
        total = sum(self._idf.get(t, self._unseen_idf) for t in query_terms)
        found = sum(self._idf[t] for t in query_terms if t in self._term_sets[i])
        return found / total if total else 0.0

    def _relevance(self, query_terms: set[str], query_vector: dict[int, float], i: int) -> float:
        return round(min(1.0, 0.7 * self._coverage(query_terms, i) + 0.3 * cosine(query_vector, self._vectors[i])), 3)

    def relevance(self, query: str, passage_id: str) -> float:
        i = next((n for n, p in enumerate(self.passages) if p.id == passage_id), None)
        if i is None:
            return 0.0
        return self._relevance(set(terms(query)), embed(query), i)

    def search(self, query: str, k: int = 4) -> list[Hit]:
        query_terms = terms(query)
        if not query_terms:
            return []
        unique_terms = set(query_terms)
        query_vector = embed(query)
        bm25 = [(self._bm25(query_terms, i), i) for i in range(len(self.passages))]
        vectors = [(cosine(query_vector, self._vectors[i]), i) for i in range(len(self.passages))]
        fused: dict[int, float] = {}
        for ranking in (bm25, vectors):
            ranked = [i for score, i in sorted(ranking, key=lambda pair: (-pair[0], pair[1])) if score > 0.02]
            for rank, i in enumerate(ranked, start=1):
                fused[i] = fused.get(i, 0.0) + 1 / (RRF_K + rank)
        ordered = sorted(fused.items(), key=lambda pair: (-pair[1], pair[0]))[:k]
        return [
            Hit(self.passages[i], round(score, 5), self._relevance(unique_terms, query_vector, i))
            for i, score in ordered
        ]


class IndexCache:
    """A small LRU of lab indexes keyed by a hash of the lab content."""

    def __init__(self, max_entries: int = 64) -> None:
        self._entries: OrderedDict[str, LabIndex] = OrderedDict()
        self._max = max_entries

    @staticmethod
    def key(lab: Lab) -> str:
        content = lab.model_dump_json(include={"slug", "steps", "faq"})
        return hashlib.sha256(content.encode()).hexdigest()

    def get(self, lab: Lab) -> LabIndex:
        key = self.key(lab)
        index = self._entries.get(key)
        if index is None:
            index = LabIndex.for_lab(lab)
            self._entries[key] = index
            if len(self._entries) > self._max:
                self._entries.popitem(last=False)
        else:
            self._entries.move_to_end(key)
        return index

    def __len__(self) -> int:
        return len(self._entries)
