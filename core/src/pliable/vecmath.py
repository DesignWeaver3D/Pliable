"""Small vector helpers on plain coordinate sequences (tuples or lists of floats)."""


def dot(a, b) -> float:
    return sum(x * y for x, y in zip(a, b))
