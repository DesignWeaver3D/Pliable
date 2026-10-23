"""The error raised for a sketch that cannot be solved or turned into a shape."""

from ..ops import OperationError


class SketchError(OperationError):
    pass
