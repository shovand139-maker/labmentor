from __future__ import annotations

from labmentor_assistant.models import Lab
from labmentor_assistant.retrieval import IndexCache, LabIndex, chunk_lab, cosine, embed
from labmentor_assistant.text import stem, terms


def test_stemming_matches_common_word_forms() -> None:
    assert {stem(w) for w in ["create", "creates", "created", "creating"]} == {"creat"}
    assert stem("replicas") == stem("replica")
    assert stem("ingress") == "ingress"
    assert stem("uses") == "use"


def test_terms_drop_stopwords_and_single_letters() -> None:
    assert terms("How do I see the logs of my app?") == ["see", "log", "app"]


def test_steps_are_chunked_on_paragraphs_and_hints_are_never_indexed(aca: Lab) -> None:
    passages = chunk_lab(aca)
    ids = [p.id for p in passages]

    assert ids[0] == "step-1"
    assert all(p.text.strip() for p in passages)
    assert [p.id for p in passages if p.kind == "faq"] == ["faq-1", "faq-2", "faq-3", "faq-4", "faq-5"]
    everything = " ".join(p.text for p in passages)
    for step in aca.steps:
        for command in step.solution:
            assert command not in everything
        if step.hints.walkthrough:
            assert " ".join(step.hints.walkthrough.split()) not in everything


def test_short_trailing_paragraphs_join_the_passage_before_them(aca: Lab) -> None:
    passages = chunk_lab(aca)

    assert all(len(p.text.split()) >= 30 for p in passages if p.kind == "step" and "-" in p.id[5:])


def test_hashed_embeddings_are_normalised_and_deterministic() -> None:
    a, b = embed("scale to zero replicas"), embed("scale to zero replicas")

    assert a == b
    assert abs(cosine(a, a) - 1.0) < 1e-9
    assert cosine(a, embed("banana bread recipe")) < 0.2


def test_search_finds_exact_names_and_troubleshooting_notes(aca: Lab) -> None:
    index = LabIndex.for_lab(aca)

    assert index.search("ResourceGroupNotFound when creating the environment")[0].passage.id == "faq-3"
    assert index.search("namespace Microsoft.App is not registered")[0].passage.id == "faq-2"
    assert index.search("which region for the resource group")[0].passage.id == "step-2"


def test_relevance_separates_on_topic_from_off_topic(aca: Lab) -> None:
    index = LabIndex.for_lab(aca)

    on_topic = index.search("my app url returns 404")[0]
    off_topic = index.search("what is a good banana bread recipe")

    assert on_topic.relevance > 0.5
    assert all(hit.relevance < 0.1 for hit in off_topic)


def test_a_query_without_content_words_returns_nothing(aca: Lab) -> None:
    assert LabIndex.for_lab(aca).search("how do I do it?") == []


def test_the_cache_reuses_an_index_until_the_content_changes(aca: Lab) -> None:
    cache = IndexCache(max_entries=2)

    first = cache.get(aca)
    again = cache.get(aca.model_copy(update={"solutions_allowed": True}))
    edited = cache.get(aca.model_copy(update={"title": aca.title, "faq": aca.faq[:1]}))

    assert first is again
    assert edited is not first
    assert len(cache) == 2


def test_the_cache_evicts_the_least_recently_used_lab(labs: dict[str, Lab]) -> None:
    cache = IndexCache(max_entries=2)
    a, b, c = labs.values()

    first = cache.get(a)
    cache.get(b)
    cache.get(a)
    cache.get(c)

    assert cache.get(a) is first
    assert len(cache) == 2
