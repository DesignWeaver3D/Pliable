"""
Document management for Pliable - handles shape data and state
"""

from OCC.Core.BRepPrimAPI import BRepPrimAPI_MakeBox
from OCC.Core.BRepBuilderAPI import BRepBuilderAPI_Copy


class Document:
    """
    Manages the current shape and related state
    Separation of data (Document) from display (Viewer)
    """

    def __init__(self):
        """Initialize document with a default cube"""
        # Create a 100x100x100mm cube as default
        self.shape = BRepPrimAPI_MakeBox(100, 100, 100).Shape()

        # Cached center of mass (recalculated when geometry changes)
        self.cached_com = None

        # Undo/redo stacks
        self.undo_stack = []
        self.redo_stack = []
        self.max_history = 20  # Limit to prevent excessive memory usage

        print("Document initialized with default cube")

    def save_to_history(self):
        """
        Save current shape to undo history before modification
        Creates an explicit copy to ensure independence from future modifications
        """
        # Create explicit copy of current shape
        shape_copy = BRepBuilderAPI_Copy(self.shape).Shape()

        # Add to undo stack
        self.undo_stack.append(shape_copy)

        # Limit history size
        if len(self.undo_stack) > self.max_history:
            self.undo_stack.pop(0)  # Remove oldest

        # Clear redo stack when new operation is performed
        self.redo_stack.clear()

        # print(f"Saved to history (undo stack: {len(self.undo_stack)} items)")

    def can_undo(self):
        """Check if undo is available"""
        return len(self.undo_stack) > 0

    def can_redo(self):
        """Check if redo is available"""
        return len(self.redo_stack) > 0

    def undo(self):
        """
        Restore previous shape from undo stack

        Returns:
            bool: True if undo was successful, False if no history available
        """
        if not self.can_undo():
            print("Nothing to undo")
            return False

        # Save current state to redo stack
        current_copy = BRepBuilderAPI_Copy(self.shape).Shape()
        self.redo_stack.append(current_copy)

        # Restore previous state
        self.shape = self.undo_stack.pop()

        # Invalidate COM cache
        self.cached_com = None

        print(f"Undo complete (undo: {len(self.undo_stack)}, redo: {len(self.redo_stack)})")
        return True

    def redo(self):
        """
        Restore next shape from redo stack

        Returns:
            bool: True if redo was successful, False if no redo available
        """
        if not self.can_redo():
            print("Nothing to redo")
            return False

        # Save current state to undo stack
        current_copy = BRepBuilderAPI_Copy(self.shape).Shape()
        self.undo_stack.append(current_copy)

        # Restore next state
        self.shape = self.redo_stack.pop()

        # Invalidate COM cache
        self.cached_com = None

        print(f"Redo complete (undo: {len(self.undo_stack)}, redo: {len(self.redo_stack)})")
        return True

    def clear_history(self):
        """Clear all undo/redo history"""
        self.undo_stack.clear()
        self.redo_stack.clear()
        print("History cleared")

    def set_shape(self, shape):
        """
        Set the current shape

        Args:
            shape: TopoDS_Shape to set as current
        """
        self.shape = shape
        # Invalidate COM cache when shape changes
        self.cached_com = None

    def get_shape(self):
        """
        Get the current shape

        Returns:
            TopoDS_Shape: Current shape
        """
        return self.shape

    def update_center_of_mass(self):
        """
        Calculate and cache the center of mass of the current shape
        Should be called after any geometry modification
        """
        from pliable.geometry import get_center_of_mass
        self.cached_com = get_center_of_mass(self.shape)
        # if self.cached_com:
        #     print(f"Center of mass updated: ({self.cached_com.X():.2f}, {self.cached_com.Y():.2f}, {self.cached_com.Z():.2f})")
        return self.cached_com

    def get_center_of_mass(self):
        """
        Get cached center of mass (calculates if not cached)

        Returns:
            gp_Pnt: Center of mass point
        """
        if self.cached_com is None:
            self.update_center_of_mass()
        return self.cached_com
