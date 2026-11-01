from pliable import symmetric, unwrap
from pliable.vecmath import dot


def test_dot():
    assert dot((1, 2, 3), (4, 5, 6)) == 32
    assert dot([1.5, 0.0], (2.0, 9.0)) == 3.0
    assert dot((), ()) == 0
    assert dot((1, 2, 3), (1, 1)) == 3  # zip stops at the shorter one


def test_symmetric_and_unwrap_use_the_shared_dot():
    assert symmetric._dot is dot
    assert unwrap._dot is dot
